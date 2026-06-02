---
id: I2026052607
title: project-overlay-loader
from_ids: [I2026052606]
tags: [prompt-center, overlay, project-root]
modules: [runtime]
doc_kind: spec
---

# I2026052607 [runtime] 项目级 prompt overlay：.snail/ prompt loader + 路径适配

## 背景

I2026052606 将 agent cwd 从 `process.cwd()` 分离为 `project.project_root`，并预留了 `projectRoot/.snail/` 作为项目级 overlay 目录、`handbook_prompt_ref` 的 `project:` scope 前缀。但两者均未实现：

1. **prompt overlay loader 不存在**：prompt-center/registry.ts:57 仅从 `process.cwd()/.meta/prompts/` 全局加载，无 project 参数。项目自建角色的手册无法生效。
2. **`project:` scope 返回 null**：builder.ts:323-328 `resolveHandbookRef()` 已有 `project:` 分支但直接返回 null，等于配了也白配。
3. **脚本路径硬编码 `process.cwd()`**：builder.ts:135 用 `process.cwd()` 拼 history script 路径。agent 在 projectRoot 下运行时，提示词中的脚本路径指向平台目录而非项目目录（#276 真机发现）。

## 目标

让项目能拥有自己的 prompt，覆盖或扩展平台默认。Skill overlay 因涉及两条通道统一问题（文本注入 vs agent 原生），拆至 #284 另行讨论。

### P1 — prompt overlay loader + project: scope

1. 实现 `projectRoot/.snail/prompts/` 加载器。
2. `resolveHandbookRef("project:xxx")` 从项目 overlay 中解析 prompt 并注入 system prompt。
3. 项目 overlay prompt 与全局 prompt 同 ID 时，项目覆盖全局（override 语义）。

### P2 — 脚本路径适配

1. builder.ts 中 history script 等路径从 `process.cwd()` 改为平台安装目录常量（启动时记录），不随 project 切换。
2. 提示词中引用的平台级资源路径始终指向平台目录，不受 agent cwd 影响。

## 非目标

- **Skill overlay**（文本注入 vs agent 原生通道统一问题未收敛，拆至 #284 讨论）。
- Frame overlay（项目不能覆盖 frame 模板——frame 定义 prompt 架构，覆盖风险过高）。
- 项目级 prompt 的 `{{#when}}` 条件扩展（沿用全局 frame 的条件体系）。
- 热加载（.snail/ 变更后需重新创建 feature / 重启对话才生效）。
- .snail/ 目录自动创建（用户自行创建，平台只在目录存在时加载）。

## 设计

### P1 详设 — prompt overlay loader

#### .snail/ 目录结构

```
projectRoot/.snail/
└── prompts/
    ├── S-10-custom-handbook.md    # 项目自定义 prompt
    └── S-03-研发者手册.md          # 覆盖全局 S-03
```

镜像 `.meta/prompts/` 的 prompts 子目录结构：
- prompts 放在 `prompts/` 子目录（不分 frames/，因为项目不能覆盖 frame）。
- prompt 文件使用相同的 YAML frontmatter 格式和 ID 命名规则。

#### prompt 加载改造

**当前**：`prompt-center/registry.ts` 模块级静态初始化，无 project 参数。

**改后**：

1. 全局 registry 保持模块级初始化不变（`process.cwd()/.meta/prompts/`）——平台 prompt 在进程启动时加载一次。
2. 新增 `loadProjectPrompts(projectRoot: string): Map<string, Prompt>` 函数：
   - 扫描 `projectRoot/.snail/prompts/`，解析 .md 文件。
   - 目录不存在或为空时返回空 Map（静默，不报错）。
   - 与全局 prompts 合并：相同 ID 时项目覆盖全局（Map merge，project 后写入覆盖 global）。
3. `buildConversationCapability()` 调用时传入 `projectRoot`，合并后的 prompt Map 用于后续解析。

```typescript
// registry.ts 新增
export function loadProjectPrompts(projectRoot: string): Map<string, Prompt> {
  const overlayRoot = path.join(projectRoot, ".snail", "prompts");
  if (!fs.existsSync(overlayRoot)) return new Map();
  const files = discoverFiles(overlayRoot).filter(f => f.endsWith(".md") && !f.includes("_template"));
  // 解析逻辑复用 parsePromptFile()
}

export function mergePrompts(global: Map<string, Prompt>, project: Map<string, Prompt>): Map<string, Prompt> {
  return new Map([...global, ...project]); // project 同 ID 覆盖 global
}
```

#### resolveHandbookRef 实现 project: scope

**当前**（builder.ts:323-328）：

```typescript
function resolveHandbookRef(ref: string): string | null {
  if (ref.startsWith("global:")) return ref.slice("global:".length);
  if (ref.startsWith("project:")) return null; // ← 未实现
  return null;
}
```

**改后**：

```typescript
function resolveHandbookRef(ref: string, projectPrompts: Map<string, Prompt>): string | null {
  if (ref.startsWith("global:")) return ref.slice("global:".length);
  if (ref.startsWith("project:")) {
    const promptId = ref.slice("project:".length);
    return projectPrompts.has(promptId) ? promptId : null;
  }
  return null;
}
```

`project:` scope 从合并后的 prompt Map 中查找。找到即返回 ID（后续渲染走统一路径），找不到返回 null（不崩溃，同当前行为）。

#### buildConversationCapability 签名变化

```typescript
// 当前
export function buildConversationCapability(context: ConversationContext): AgentCapability

// 改后
export function buildConversationCapability(context: ConversationContext): AgentCapability
// context.project.project_root 已有，内部从 project_root 加载 overlay
```

不改外部签名。`context.project.project_root` 已经在 context 中（I2026052606 成果），builder 内部自行加载 overlay。

### P2 详设 — 脚本路径适配

#### 平台安装目录常量

新增模块 `src/shared/platform-paths.ts`：

```typescript
// 进程启动时记录，不随 project 切换
export const PLATFORM_ROOT = process.cwd(); // main.ts 启动时的 cwd
export const PLATFORM_META = path.join(PLATFORM_ROOT, ".meta");
```

**Why 用启动时 `process.cwd()` 而非 `__dirname`**：`__dirname` 指向编译产物目录（`dist/`），而 `.meta/` 在仓库根目录。启动时的 `process.cwd()` 就是仓库根，且进程生命周期内不变（agent spawn 用 child_process 不影响父进程 cwd）。

#### builder.ts 路径修正

```typescript
// 当前 (builder.ts:135)
const historyScriptPath = path.join(process.cwd(), ".meta", "scripts", "conversation-history");

// 改后
import { PLATFORM_META } from "../shared/platform-paths";
const historyScriptPath = path.join(PLATFORM_META, "scripts", "conversation-history");
```

#### 全局扫描：其他 process.cwd() 引用

I2026052606 已确认 28 处 `process.cwd()` 中 6 处改为 projectRoot、22 处不变。本 feature 在 22 处中找到 builder.ts 这 1 处需改为 PLATFORM_ROOT。其余 21 处（DB / config / logger / .meta 加载）语义正确，不动。

## 生效路径

- `src/prompt-center/registry.ts`：新增 `loadProjectPrompts()` + `mergePrompts()`
- `src/prompt-center/builder.ts`：`resolveHandbookRef()` 实现 project: scope + overlay 集成 + 脚本路径修正
- `src/shared/platform-paths.ts`：新增平台目录常量
- `src/interaction-entry/api/server.ts`（或 `main.ts`）：确保 PLATFORM_ROOT 在正确时机初始化

## 改动范围

**P1**：prompt-center/registry.ts（loadProjectPrompts + mergePrompts）、prompt-center/builder.ts（resolveHandbookRef 改造 + buildConversationCapability 内部集成 overlay）、测试

**P2**：shared/platform-paths.ts（新增）、prompt-center/builder.ts（脚本路径改用 PLATFORM_META）、测试

## 验证

### P1
- [ ] `projectRoot/.snail/prompts/` 下放一个自定义 prompt（如 `P-01-my-handbook.md`），`handbook_prompt_ref = "project:P-01"` 的角色在 system prompt 中看到该手册内容
- [ ] `projectRoot/.snail/prompts/S-03-研发者手册.md` 覆盖全局 S-03，该项目的研发者看到项目版手册而非全局版
- [ ] 覆盖仅影响该 project：其他 project（含 snail-shell 自身）仍用全局 S-03
- [ ] `.snail/` 目录不存在：无报错，行为与当前完全一致
- [ ] `.snail/prompts/` 存在但为空：无报错，不加载任何项目 prompt
- [ ] `project:xxx` ref 指向不存在的 prompt：不崩溃，该角色无手册注入（同当前行为）
- [ ] 全局 prompt 的 skill_references 在项目 overlay prompt 中同样被正确收集

### P2
- [ ] builder.ts 中脚本路径使用 PLATFORM_META，不含 `process.cwd()` 调用
- [ ] agent 在非 cwd 的 projectRoot 下运行时，提示词中脚本路径指向平台安装目录
- [ ] snail-shell 自身项目（project_root = process.cwd()）行为不回归

### 通用
- [ ] tsc / lint / 测试全过
- [ ] 代码中 builder.ts 不再有面向项目资源的 `process.cwd()` 调用

## 关联

- **前置**: I2026052606（project_root 分离 + resolveHandbookRef project: 预留 + .snail/ 防御性兼容）
- **相关**: #276（提示词脚本路径未适配 project_root cwd 分离）
- **相关**: #279（项目级 prompt/skill overlay：实现 projectRoot/.snail/ loader — 本 feature 完成 prompt 部分）
- **相关**: #284（Skill overlay 架构讨论：文本注入 vs agent 原生通道 — 从本 feature 拆出）
- **相关**: #254（project_root + 项目级 overlay 加载 — 本 feature 完成 prompt overlay 部分）
- **相关**: #277（handbook_prompt_ref 绑定维度——本 feature 提供 project: scope 机制，绑定维度讨论正交）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | overlay 语义：同 ID 是覆盖还是合并 | 覆盖（override）。项目 prompt 同 ID 替换全局。合并语义在 prompt 层面不好定义（两份手册拼接没有意义） | 2026-05-26 |
| 2 | frame 是否允许项目 overlay | 不允许。frame 定义 prompt 架构（哪些 slot、什么条件注入），覆盖可能破坏 skill_references 收集链路和 `{{#when}}` 条件体系。项目定制走 prompt overlay | 2026-05-26 |
| 3 | 加载时机：模块级静态 vs 按需加载 | 全局 registry 保持模块级静态；项目 overlay 在 buildConversationCapability 调用时按需加载。因为 project 是动态的（多 project 共存），不能在启动时绑定单个 project | 2026-05-26 |
| 4 | 平台路径用 `__dirname` vs 启动时 `process.cwd()` | 启动时 `process.cwd()`。`__dirname` 指向 `dist/`（编译产物），`.meta/` 在仓库根。启动时 cwd = 仓库根且进程内不变 | 2026-05-26 |
| 5 | overlay 性能：每次 buildCapability 都扫磁盘 | 可接受。prompt 文件量小（十几个），fs.existsSync + readdir 开销忽略不计。后续如有性能问题可加缓存，本期不做 | 2026-05-26 |
| 6 | 热加载 | 不做。.snail/ 变更后需重新创建 feature 或重启对话。理由：prompt 变更是低频操作，热加载增加复杂度但收益极低 | 2026-05-26 |
| 7 | skill overlay 是否纳入本 feature | 拆出。当前 skill 系统有两条互不相通的通道（文本注入 vs agent 原生目录），项目级 skill overlay 需先收敛架构方向再实现。拆至 #284 讨论 | 2026-05-27 |

## 范围变更记录

- 2026-05-26：初始版本。从 I2026052606 What's Next 拆出，合并 #276 + #279。
- 2026-05-27（Design Gate）：skill overlay 从 scope 中移除（#284），本 feature 聚焦 prompt overlay + 路径适配。
