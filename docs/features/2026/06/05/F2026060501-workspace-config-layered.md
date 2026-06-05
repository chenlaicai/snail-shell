---
id: F2026060501
title: workspace-config-layered
from_ids: [F2026060112]
tags: [config, workspace, architecture]
modules: [persistence, workspace-workflow, web]
doc_kind: spec
---

# F2026060501 [config] workspace 配置两层分离

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 `config/workspaces.json` 承担了双重职责：既做注册表（哪些 ws 存在），又做数据源（ws 的所有配置字段）。同时 `.snail/workspace.json` 又存储了 name、summary、default_sop_key，与系统级配置形成冗余。

问题：

1. ws 配置不是自包含的——ws 元数据（name、summary、sop_bindings）与 ws 目录分离存储在平台级文件中
2. 新增 ws 需要同时修改 `config/workspaces.json`（添加完整对象）和可能的 `.snail/workspace.json`，职责不清
3. `config/workspaces.json` 体积随 ws 数量和配置复杂度增长，而它的核心价值只是"告诉系统去哪里找 ws"
4. evolution-center 作为系统内置模块，被强行塞入 workspace 体系（`workspace_root` 指向 `{{process.cwd()}}`），与 snail-shell 共用目录，职责混淆

## 目标

### G1 — workspace 配置两层分离

将 workspace 配置拆分为两层，职责清晰分离：

- **系统层**（`config/workspaces.json`）：仅做注册表，列出 ws 目录路径
- **ws 层**（`<ws>/.snail/init.json`）：ws 自身的全部配置，自包含

核心原则：**ws 是自包含的**。系统只知道"哪里有 ws"，ws 长什么样由 ws 自己说了算。

### G2 — evolution center 从 workspace 物理概念中移除

evolution center 不是 workspace，而是跨 workspace 的治理服务。当前 evolution center 被强行塞入 workspace 体系（`workspace_root` 指向 `{{process.cwd()}}`），导致职责混淆。

改造：
- evolution center 不再是 workspace，从注册表和 workspace 体系中完全移除
- evolution item 的 issue/stage/conversation 挂到**来源 workspace**（`item.workspace_id`），而非固定的 `"evolution-center"`
- evolution SOP 是全局固定的 platform 级 SOP（`config/sop/evolution/`），不依赖任何 workspace 绑定
- `config/evolution.json` 仅保留 SOP 绑定配置（role binding），不含 workspace 字段

## 非目标

- 不改变 `.snail/` 下 SOP、prompts、skills 的目录结构
- FileConfigStore 对外接口签名随 `module` 移除和 evolution center 独立同步调整（非独立变更）
- 不改变 DB schema（运行时状态表不变）
- 不改变 API 端点路径（行为变化，路径不变）
- 不引入文件变更监听或热加载
- 不处理 `deleteWorkspace`（当前无此 API，不在 scope）

## 设计

### 1. 文件结构变更

#### `config/workspaces.json` — 纯路径数组

**Before:**
```json
{
  "workspaces": [
    {
      "id": "snail-shell",
      "module": "workspace_management",
      "name": "Snail Shell",
      "summary": "Default workspace",
      "workspace_root": "{{process.cwd()}}",
      "guard_profile": null,
      "sop_bindings": [...]
    },
    {
      "id": "evolution-center",
      "module": "evolution",
      "name": "Evolution Center",
      "summary": "演进中心内置工作区",
      "workspace_root": "{{process.cwd()}}",
      "sop_bindings": [...]
    }
  ]
}
```

**After:**
```json
[
  "{{process.cwd()}}",
  "/path/to/external-ws"
]
```

- 纯字符串数组，每个元素是一个 ws 目录路径
- 支持 `{{process.cwd()}}` 模板变量（行为不变）
- 不含任何 ws 配置信息
- evolution-center 不在此文件中——已独立到 `config/evolution.json`
- **注册表是 ws 发现的唯一入口**：路径列在注册表中但 init.json 不存在 → 启动时报错跳过并日志警告；init.json 存在但未注册 → 系统不感知

#### `<ws>/.snail/init.json` — ws 全量配置

**Before** (`.snail/workspace.json`):
```json
{"name":"Snail Shell","summary":"Default workspace","default_sop_key":"code-delivery"}
```

**After** (`.snail/init.json`):
```json
{
  "name": "Snail Shell",
  "summary": "Default workspace",
  "guard_profile": null,
  "sop_bindings": [
    {
      "sop_id": "code-delivery",
      "is_default": true,
      "role_bindings": {
        "designer": "claude-code-opus-4-7",
        "developer": "claude-code-opus-4-7"
      }
    }
  ]
}
```

- 从 `workspace.json` 更名为 `init.json`，强调"初始化/引导"语义
- 包含原 `config/workspaces.json` 中除 `id`、`workspace_root`、`module` 外的全部字段
- `guard_profile`、`sop_bindings` 从系统级下沉到 ws 级
- 去掉 `module`——evolution center 已独立，用户 ws 无类型区分需求
- 去掉 `default_sop_key`——用 `sop_bindings[].is_default` 唯一表达默认 SOP，消除冗余
- `guard_profile` 语义：`null` = 使用 `config/guard-profile.json` 系统默认策略，非 null = ws 级覆盖。合并逻辑不变（非目标）

### 2. ws ID 派生规则

去掉显式 `id` 字段后，ws ID 从目录名自动派生：

```
/usr/example-ws  →  id = "example-ws"
{{process.cwd()}} →  id = "snail-shell"  (目录名)
```

规则：
- ID = `path.basename(resolvedWorkspaceRoot)`
- 注册表路径必须为绝对路径（或含 `{{process.cwd()}}`），不允许相对路径
- 目录名冲突 → 启动时报错拒绝加载，要求用户手动解决（实际场景中不会发生）
- 目录重命名 = ws 销毁 + 重建（ID 变更导致 DB 引用断裂，属于预期行为）

### 3. `<ws>/.snail/` 目录完整结构

| 路径 | 职责 | 来源 |
|---|---|---|
| `init.json` | ws 元数据 + 配置（name、summary、guard_profile、sop_bindings） | **本次变更**：从 workspace.json 更名 + 扩展 |
| `config/sop/*.yaml` | ws 级 SOP 定义 | 不变 |
| `prompts/*.md` | ws 级提示词文档 | 不变 |
| `skills/*/SKILL.md` | ws 级 skill 定义 | 不变 |
| `worktrees/` | git worktree 运行时目录 | 不变 |

### 4. `config/` 平台级目录完整结构

| 路径 | 职责 | 来源 |
|---|---|---|
| `workspaces.json` | ws 注册表：纯路径数组（仅用户 ws） | **本次变更**：从对象数组简化为字符串数组 |
| `evolution.json` | evolution center 独立配置 | **本次变更**：从 workspace 体系中独立出来 |
| `sop/<key>/` | 平台级 SOP 模板（YAML + handbook） | 不变 |
| `guard-profile.json` | 系统默认安全策略 | 不变 |

#### `config/evolution.json` — evolution 治理服务配置

```json
{
  "sop_id": "evolution",
  "role_bindings": {
    "evolution-executor": "opencode-gpt-5-5"
  }
}
```

- 不是 workspace 配置——无 `name`、`summary`、`guard_profile` 等 workspace 字段
- 仅定义 evolution SOP 的 role binding（哪个 template 执行演进治理）
- evolution SOP YAML 在 `config/sop/evolution/`，是 platform 级 SOP
- evolution item 的 issue/stage/conversation 挂到来源 workspace（`item.workspace_id`），不挂到 evolution center

### 5. FileConfigStore 改造

#### 启动加载流程

```
1. 读 config/workspaces.json → 路径数组（不存在则为空数组）
2. 对每个路径：
   a. resolve 模板变量 → 绝对路径
   b. 派生 id = basename(resolvedPath)
   c. 检查 id 是否与已加载的 ws 冲突 → 冲突则报错拒绝加载
   d. 读 <ws>/.snail/init.json → 不存在则日志警告跳过
   e. 合并为 WorkspaceCacheEntry { id, workspace_root, original_path, ...init.json fields }
   f. 写入 workspaceCache
3. 读 config/evolution.json → evolutionConfig（不存在则为 null）
```

#### evolution 治理配置

- **缓存**：FileConfigStore 新增字段 `evolutionConfig`，类型为 `EvolutionConfig`（见下方定义）
- **SOP 解析**：evolution SOP 是 platform 级（`config/sop/evolution/`），stage definition 直接从 SOP 定义获取，不通过 workspace 绑定
- **role binding**：从 `config/evolution.json` 的 `role_bindings` 读取，用于 governance conversation 的 template 映射

```typescript
interface EvolutionConfig {
  sop_id: string;
  role_bindings: Record<string, string>;
}
```

#### WorkspaceFileEntry 变更

```typescript
// Before: 所有字段来自 config/workspaces.json
interface WorkspaceFileEntry {
  id: string;
  module: WorkspaceModule;
  name: string;
  summary: string;
  workspace_root: string;
  guard_profile?: Record<string, unknown> | null;
  sop_bindings: Array<{...}>;
}

// After: init.json 的 schema（snail-loader.ts 导出，file-config-store.ts 引用）
// 合并原 WorkspaceInitConfig 和 SnailWorkspaceConfig 为一个类型
interface SnailWorkspaceConfig {
  name: string;
  summary?: string;
  guard_profile?: Record<string, unknown> | null;
  sop_bindings: Array<{
    sop_id: string;
    is_default: boolean;
    role_bindings: Record<string, string | string[]>;
  }>;
}

// 内部缓存条目 = 派生字段 + init.json 内容
interface WorkspaceCacheEntry {
  id: string;                    // 派生自目录名
  workspace_root: string;        // resolved 后的绝对路径
  original_path: string;         // 注册表中的原始字符串（可能含模板变量）
  name: string;                  // 来自 init.json
  summary: string;               // 来自 init.json
  guard_profile: ...;            // 来自 init.json
  sop_bindings: [...];           // 来自 init.json
}
```

#### 写操作变更

- `createWorkspace()`：先创建 `<ws>/.snail/init.json`，成功后原子写注册表（追加路径）。init.json 创建失败 → 返回 500，注册表不动
- `updateWorkspace()`：修改 cache → 调用 `saveInitConfig()` 回写 `init.json`（不写注册表，注册表不含 name/summary 等字段）
- `createWorkspaceSop()` / `updateWorkspaceSop()` / `deleteWorkspaceSop()`：修改 cache 中的 `sop_bindings` → 从 cache 拿 `workspace_root` → 调用 `saveInitConfig(entry.workspace_root, ...)` 回写 `init.json`
- `saveWorkspacesFile()`：只写路径数组（从 cache 中取 `original_path`）
- 新增 `saveInitConfig`：

```typescript
private saveInitConfig(workspaceRoot: string, config: SnailWorkspaceConfig): void
// 写 <ws>/.snail/init.json，原子写（tmp + rename）
```

#### 读操作变更

- `getWorkspace()` / `findWorkspaceByName()` → 从内存 cache 读（行为不变），不含 evolution center（已不是 workspace）
- `listWorkspaces()` → 去掉 `module` 参数，签名变为 `listWorkspaces(limit?, offset?): Workspace[]`
- `getEvolutionConfig()` → 新增，返回 `EvolutionConfig | null`，从 `evolutionConfig` 读
- cache key 仍为 ws ID（目录名）

### 6. snail-loader 改造

#### `initializeSnailDirectory()`

- 创建 `init.json`（替代 `workspace.json`），写入完整 ws 配置
- 参数扩展：新增 `guardProfile`、`sopBindings` 可选参数

```typescript
export function initializeSnailDirectory(
  workspaceRoot: string,
  options?: {
    name?: string;
    summary?: string;
    sopKey?: string;
    guardProfile?: Record<string, unknown> | null;
    sopBindings?: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }>;
  },
): WorkspaceContext
```

- `sopKey`：控制从平台复制哪个 SOP YAML 到 `.snail/config/sop/`（初始化引导用）
- `sopBindings`：写入 `init.json` 的 SOP 绑定关系（含 `is_default` 标记默认 SOP）
- 两者独立：`sopKey` 决定"带哪些 SOP 文件"，`sopBindings` 决定"绑定哪些 SOP"
- **创建 ws 时的映射**：用户的 SOP 选择同时映射到 `sopKey`（复制 YAML 文件）和 `sopBindings`（写入 init.json，默认绑定所选 SOP）

#### `loadWorkspaceContext()` / `loadWorkspaceConfigOnly()`

- 读取 `init.json`（替代 `workspace.json`）
- `SnailWorkspaceConfig` 接口扩展为包含 `guard_profile`、`sop_bindings`（合并原 `WorkspaceInitConfig`，唯一类型由 snail-loader.ts 导出）

#### `snailPaths` 常量

```typescript
// Before
snailPaths.workspaceJson = (root) => path.join(root, ".snail", "workspace.json")

// After
snailPaths.initJson = (root) => path.join(root, ".snail", "init.json")
```

### 7. 移除 seed 逻辑

启动流程变为纯读取，不做任何自动创建或初始化：

```
1. 读 config/workspaces.json → 路径数组（不存在则为空数组）
2. 逐个读 <ws>/.snail/init.json → 填充 cache
3. 读 config/evolution.json → evolutionConfig（不存在则为 null）
```

- 移除 `seedSelfWorkspace()`——不存在 seed 概念
- 配置文件不存在 = 对应功能为空，系统照常启动
- 用户/部署流程自行管理配置文件的创建和内容

### 8. API 行为变更

端点路径不变，行为调整：

| 端点 | 行为变化 |
|---|---|
| `POST /workspaces` | 先创建 `init.json` + 初始化 `.snail/` 目录，成功后追加路径到注册表。失败返回 500，注册表不动 |
| `PATCH /workspaces/:id` | 修改 `init.json` |
| `POST /workspaces/:id/load-snail` | 读 `init.json` 获取当前配置，替换后回写 |
| `POST /workspaces/detect-snail` | 检测 `.snail/init.json` 存在性。存在则解析返回 `{ name, summary, sop_bindings }` 用于前端预填；不存在返回 `{ found: false }`；格式错误返回错误 |
| `GET /workspaces` | 去掉 `module` 查询参数（`WorkspaceModule` 已移除） |
| `POST /evolution/items` | 创建 evolution item 时，issue/stage/conversation 挂到 `item.workspace_id`（来源 ws），不再挂到 `"evolution-center"` |
| 其他 | 从 cache 读，行为不变 |

### 9. Evolution 模型改造

#### `EvolutionModel.create()` — issue 挂载到来源 ws

当前 4-record transaction 中 issue/stage/conversation 的 `workspace_id` 全部硬编码为 `"evolution-center"`。改造后改为 `input.workspaceId`（即 item 来源 ws）：

```typescript
// Before
const issue = { workspace_id: "evolution-center", ... };
const stage = { workspace_id: "evolution-center", ... };
const conversation = { workspace_id: "evolution-center", ... };

// After
const issue = { workspace_id: input.workspaceId, ... };
const stage = { workspace_id: input.workspaceId, ... };
const conversation = { workspace_id: input.workspaceId, ... };
```

#### stage_definition_id 解析方式变更

当前通过 `getStageDefinitionByKey("evolution-center", "development")` 按 workspace 绑定查找。evolution center 不再是 workspace 后，改为直接从 SOP 定义获取：

```typescript
// Before
const stageDefinition = this.fileConfigStore.getStageDefinitionByKey("evolution-center", "development");

// After
const sop = this.fileConfigStore.getSopByKey("platform", "evolution");
const stageDefinition = sop.stage_definitions.find(sd => sd.key === "development");
```

#### `buildEvolutionSystemPrompt()` — 不依赖 evolution-center ws

当前加载 `"evolution-center"` workspace 来获取 stage/role 定义。改造后直接从 SOP 定义加载：

- stage definition：从 `config/sop/evolution/evolution.yaml` 解析
- role definition：从 SOP YAML 解析 + `config/evolution.json` 的 `role_bindings` 应用 template 映射
- 调用链：`store.getEvolutionConfig()` 获取 role_bindings → `fileConfigStore.getSopByKey("platform", "evolution")` 获取 SOP 定义 → 合并构建 prompt
- 不再调用 `store.getWorkspace("evolution-center")`

#### 前端 `openEvolutionConversation`

当前切换到 `"evolution-center"` workspace。改造后切换到 issue 所在的**来源 ws**（从 issue.workspace_id 获取）。

### 10. 前端适配

- `workspace-config-view.js`：ws 创建表单提交时，`name`、`summary`、`sop_bindings` 写入 `init.json`（通过 API 透传）
- `workspace-controller.js`：ws 列表展示从 API 获取（API 行为不变，前端无感）
- `POST /workspaces/detect-snail` 返回的 ws 配置来源从 `workspace.json` 改为 `init.json`

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `config/workspaces.json` | 修改 | 从对象数组简化为纯路径数组；移除 evolution-center 条目 |
| `config/evolution.json` | 新增 | evolution center 独立配置文件 |
| `config/workspaces.json.example` | 修改 | 更新示例格式 |
| `.snail/workspace.json` | 重命名 | → `.snail/init.json`，字段扩展，移除 `module` |
| `src/persistence/file-config-store.ts` | 修改 | 启动加载改为"读路径数组 + 逐个读 init.json"；写操作改为写 init.json + 路径数组；移除 `WorkspaceFileEntry`，引用 `SnailWorkspaceConfig`；新增 `saveInitConfig()`、`evolutionConfig`、`getEvolutionConfig()`、`EvolutionConfig` 接口；`listWorkspaces` 去掉 `module` 参数；`createWorkspace` 顺序改为先创建后注册；移除 `evolutionCenterCache`、`EVOLUTION_CENTER_ID`、`getEvolutionCenter()` |
| `src/shared/types.ts` | 修改 | 移除 `Workspace.module` 字段和 `WorkspaceModule` 类型 |
| `src/shared/domain-types.ts` | 修改 | 移除 `WorkspaceModule`；`ConversationOwnerType` 保留 `"evolution"` 值（owner_type 语义不变） |
| `src/persistence/evolution-model.ts` | 修改 | `create()` 中 issue/stage/conversation 的 `workspace_id` 从硬编码 `"evolution-center"` 改为 `input.workspaceId`；stage_definition_id 解析改为直接从 SOP 定义获取（`getSopByKey("platform", "evolution")`） |
| `src/evolution-center/evolution-prompt.ts` | 修改 | `buildEvolutionSystemPrompt()` 不再加载 `"evolution-center"` workspace，改为从 SOP 定义获取 stage/role 信息 + `config/evolution.json` 的 role_bindings |
| `src/workspace-workflow/snail-loader.ts` | 修改 | `snailPaths.workspaceJson` → `snailPaths.initJson`；`SnailWorkspaceConfig` 接口扩展（合并原 `WorkspaceInitConfig`，移除 `module`）；`initializeSnailDirectory` 参数扩展 |
| `src/workspace-workflow/manager.ts` | 修改 | `createWorkspace()` 适配新文件结构；`loadWorkspaceFromSnail()` 读写 init.json |
| `src/workspace-workflow/manager-collaboration.ts` | 修改 | evolution prompt 分支不依赖 `"evolution-center"` workspace（如有直接引用） |
| `src/web/app.js` | 修改 | `openEvolutionConversation` 切换到 issue 所在的来源 ws（`issue.workspace_id`），而非固定的 `"evolution-center"` |
| `src/web/workspace-tree-view.js` | 修改 | 移除过滤 `"evolution-center"` 的逻辑（不再有这个 ws） |
| `.meta/scripts/db-bridge.js` | 修改 | `evolutionCandidate.create()` 中 issue/stage/conversation 的 `workspace_id` 从硬编码改为 `input.workspace_id`；stage_definition_id 解析方式同步修改 |
| `src/workspace-workflow/self-workspace-seed.ts` | 删除 | 移除 seed 逻辑——启动时纯读取配置文件，不做自动创建 |
| `src/main.ts` | 修改 | 移除 `seedSelfWorkspace()` 调用；启动流程改为纯读取配置文件 |
| `src/interaction-entry/api/server.ts` | 修改 | `detect-snail` 检测 init.json；ws 创建 API 适配新结构 |
| `src/web/workspace-config-view.js` | 修改 | detect-snail 响应字段适配（如有） |
| `src/web/workspace-controller.js` | 修改 | 适配 init.json（如有前端直接读文件的逻辑） |
| `tests/**/*.ts` | 修改 | 测试 helper 适配新文件格式 |

**不改动的文件：**
- `src/persistence/schema.ts`（DB schema 不变）
- `src/persistence/store.ts`（纯委托层，对外接口签名不变）
- `src/interaction-entry/api/server.ts` 的端点路径（不变）
- `.snail/config/sop/`、`.snail/prompts/`、`.snail/skills/`（目录结构不变）
- SOP 加载逻辑（`sop-file-utils.ts` 不变）

## 验证

### 注册表

- [ ] `config/workspaces.json` 为纯路径数组格式
- [ ] `{{process.cwd()}}` 模板变量正确解析
- [ ] 路径数组为空时系统正常启动（无 ws）
- [ ] `main.ts` 中无 `seedSelfWorkspace` / `seedEvolutionCenter` 调用

### ws init.json

- [ ] `<ws>/.snail/init.json` 包含 name、summary、guard_profile、sop_bindings（无 `module`）
- [ ] `workspace.json` 不再存在（已重命名为 init.json），无残留
- [ ] `default_sop_key` 字段不存在，用 `sop_bindings[].is_default` 表达默认 SOP
- [ ] `init.json` 中 sop_bindings 的 sop_id 正确解析为 SOP 文件

### evolution 治理

- [ ] `config/evolution.json` 加载为 `EvolutionConfig`（sop_id + role_bindings）
- [ ] `"evolution-center"` 不在 `config/workspaces.json` 注册表中
- [ ] `"evolution-center"` 不在 workspace 体系中（`getWorkspace("evolution-center")` 返回 `undefined`）
- [ ] `EvolutionModel.create()` 中 issue/stage/conversation 的 `workspace_id` = `input.workspaceId`（来源 ws）
- [ ] stage_definition_id 从 SOP 定义直接获取（`getSopByKey("platform", "evolution")`），不通过 workspace 绑定
- [ ] `buildEvolutionSystemPrompt()` 不依赖 `"evolution-center"` workspace
- [ ] `openEvolutionConversation` 切换到 issue 所在的来源 ws
- [ ] `workspace-tree-view.js` 不过滤 `"evolution-center"`（已不存在）
- [ ] `self-workspace-seed.ts` 已删除，无 seed 逻辑残留
- [ ] `db-bridge.js` 的 evolution-create 逻辑同步修改

### ws ID 派生

- [ ] ID 从 `path.basename(resolvedWorkspaceRoot)` 正确派生
- [ ] 内置 ws（snail-shell）ID 从仓库目录名派生（依赖目录名，设计如此）
- [ ] API 中 ws ID 与派生结果一致

### FileConfigStore

- [ ] `loadAll()` 从路径数组 + init.json 正确加载所有 ws
- [ ] `createWorkspace()` 先创建 init.json 再写注册表（顺序正确，失败时注册表不动）
- [ ] `updateWorkspace()` 回写 init.json（不写注册表）
- [ ] SOP binding CRUD 从 cache 拿 `workspace_root`，回写 init.json
- [ ] `saveWorkspacesFile()` 写回时用 `original_path`（不反向模板化）
- [ ] 内存 cache 中 `original_path` 正确记录
- [ ] `listWorkspaces()` 无 `module` 参数
- [ ] `getEvolutionConfig()` 正确返回 `EvolutionConfig | null`
- [ ] 无 `WorkspaceFileEntry` 残留（旧接口完全移除）
- [ ] `WorkspaceInitConfig` 不存在（已合并为 `SnailWorkspaceConfig`，由 snail-loader.ts 导出）
- [ ] `WorkspaceModule` 类型不存在（已移除）
- [ ] `deleteWorkspace` 不在 scope（当前无此 API）

### snail-loader

- [ ] `initializeSnailDirectory()` 创建 `init.json`（非 `workspace.json`）
- [ ] `loadWorkspaceContext()` 从 `init.json` 读取配置
- [ ] `SnailWorkspaceConfig` 包含扩展字段（guard_profile、sop_bindings，无 `module`）
- [ ] `SnailWorkspaceConfig` 是 init.json schema 的唯一类型定义（无 `WorkspaceInitConfig` 残留）

### 创建 ws 流程

- [ ] 通过 API 创建 ws，`init.json` 正确写入
- [ ] 注册表自动追加新路径
- [ ] `.snail` 目录下 SOP/prompts/skills 正常初始化

### 无残留

- [ ] `WorkspaceFileEntry` 接口不存在（完全移除）
- [ ] `WorkspaceModule` 类型不存在于 `shared/types.ts`、`domain-types.ts` 和任何代码中
- [ ] `Workspace.module` 字段不存在于 `shared/types.ts`
- [ ] `workspace.json` 文件名引用不存在于任何代码中
- [ ] `default_sop_key` 字段不存在于 init.json 和相关类型中
- [ ] `module` 字段不存在于 init.json 和相关类型中
- [ ] `config/workspaces.json` 中不存在对象格式（纯字符串数组）
- [ ] `listWorkspaces()` 无 `module` 参数
- [ ] `"evolution-center"` 作为 workspace_id 硬编码不存在于 evolution-model.ts、evolution-prompt.ts、db-bridge.js 中
- [ ] `evolutionCenterCache`、`EVOLUTION_CENTER_ID`、`getEvolutionCenter()` 不存在于 FileConfigStore
- [ ] `self-workspace-seed.ts` 文件不存在
- [ ] `seedSelfWorkspace` / `seedEvolutionCenter` 函数不存在
- [ ] 无兼容层、无 fallback 到旧格式的逻辑

### 通用

- [ ] `npm run check` 全部通过
- [ ] `config/workspaces.json.example` 更新为新格式

## 关联

- **前置**: F2026060112（配置表文件化）— 建立了 FileConfigStore 架构和 `config/workspaces.json` 作为唯一真值源的模式

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| D1 | ws ID 去掉显式字段后如何派生 | 从目录名派生（`path.basename`）。目录名冲突 → 报错拒绝加载。目录重命名 = ws 销毁+重建 | 2026-06-05 |
| D2 | `workspace.json` 更名为 `init.json` | 强调"初始化/引导"语义，与注册表的"列表"语义区分 | 2026-06-05 |
| D3 | 加载策略 | 启动时 eager load + 缓存，与当前行为一致。5-20 个 ws 的额外 IO 可忽略 | 2026-06-05 |
| D4 | `default_sop_key` 去掉 | 用 `sop_bindings[].is_default` 唯一表达默认 SOP，消除冗余。无强消费方依赖 `default_sop_key` | 2026-06-05 |
| D5 | 注册表格式 | 纯字符串数组 `["/path"]`，不用 `[{workspace_root: "/path"}]`。注册表就是路径列表，不需要包裹层 | 2026-06-05 |
| D6 | 注册表是 ws 发现的唯一入口 | 路径列在注册表但 init.json 不存在 → 报错跳过。init.json 存在但未注册 → 系统不感知 | 2026-06-05 |
| D7 | `module` 字段移除 | evolution center 已独立，用户 ws 无类型区分需求，`WorkspaceModule` 类型一并移除 | 2026-06-05 |
| D8 | 创建 ws 原子性 | 先创建 init.json 后写注册表。失败返回 500，注册表不动。无孤儿路径 | 2026-06-05 |
| D9 | 不做迁移 | 用户明确不需要迁移和兼容性。直接删除旧格式代码，不留兼容层 | 2026-06-05 |
| D10 | 注册表路径不允许相对路径 | 防止不同 CWD 下派生出不同 ID。必须为绝对路径或含 `{{process.cwd()}}` | 2026-06-05 |
| D11 | `WorkspaceInitConfig` 与 `SnailWorkspaceConfig` 合并 | 字段完全一致，合并为 `SnailWorkspaceConfig` 由 snail-loader.ts 导出，file-config-store.ts 引用。避免两个"几乎一样"的类型漂移 | 2026-06-05 |
| D12 | evolution center 从 workspace 物理概念中移除 | 不再是 workspace。evolution item 的 issue/stage/conversation 挂到来源 ws（`item.workspace_id`）。evolution SOP 是 platform 级，不依赖 ws 绑定。`config/evolution.json` 仅保留 role binding 配置 | 2026-06-05 |
| D13 | 移除 seed 逻辑 | 启动时纯读取配置文件，不做自动创建。`self-workspace-seed.ts` 整体删除。配置文件不存在 = 对应功能为空 | 2026-06-05 |
| D14 | 回写链路：init.json 而非注册表 | `updateWorkspace` 和 SOP binding CRUD 回写 init.json（通过 `saveInitConfig`）。注册表只在 create 时追加路径，不含 ws 配置字段 | 2026-06-05 |
| D15 | `sopKey` 与 `sopBindings` 独立 | `sopKey` 控制 YAML 文件复制，`sopBindings` 写入 init.json。创建 ws 时用户 SOP 选择同时映射到两者 | 2026-06-05 |
| D16 | `deleteWorkspace` 不在 scope | 当前无此 API，不处理 | 2026-06-05 |
| D17 | 注册表中 ws 的 ID 稳定性 | ID 依赖目录名，不保证跨目录名稳定。内置 ws（snail-shell）ID 从仓库目录名派生，设计如此 | 2026-06-05 |
| D18 | evolution center 从 workspace 物理概念移除 | 不再是 workspace。issue/stage/conversation 挂到来源 ws。`getEvolutionConfig()` 返回 SOP 绑定配置 | 2026-06-05 |
| D19 | `createWorkspace` 顺序反转 | 先创建 init.json，成功后写注册表。失败返回 500，注册表不动 | 2026-06-05 |
| D20 | `listWorkspaces` 去掉 `module` 参数 | `WorkspaceModule` 已移除，方法签名和 API 查询参数同步清理 | 2026-06-05 |
| D21 | `evolution.json` 定义 `EvolutionConfig` | 仅含 `sop_id` + `role_bindings`，不是 workspace 配置。独立类型，不复用 `SnailWorkspaceConfig` | 2026-06-05 |
| D22 | evolution issue 挂载到来源 ws | `EvolutionModel.create()` 中 issue/stage/conversation 的 `workspace_id` 从硬编码改为 `input.workspaceId` | 2026-06-05 |
| D23 | evolution stage_definition 直接从 SOP 获取 | `getSopByKey("platform", "evolution")` 替代 `getStageDefinitionByKey("evolution-center", ...)` | 2026-06-05 |
