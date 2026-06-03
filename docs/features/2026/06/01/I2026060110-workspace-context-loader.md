---
id: I2026060110
title: workspace-context-loader
from_ids: [I2026052607, I2026053002, I2026053103, I2026053104]
tags: [architecture, workspace, loader]
modules: [workspace-workflow, prompt-center, skill-center, persistence]
doc_kind: spec
---

# I2026060110 [workspace-workflow] WorkspaceContext 统一加载器

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

`.snail/` 目录是 workspace 级配置的唯一真相源（I2026053103），当前由 4 个模块各自独立加载不同子目录：

- `snail-loader.ts`：`workspace.json` + `sop/*.json`（JSON 格式，手动触发）
- `sop-loader.ts`：`sop/*.yaml`（YAML 格式，启动时自动加载）
- `prompt-center/registry.ts`：`prompts/*.md`（按需加载）
- `skill-center/registry.ts`：`skills/*/SKILL.md`（按需加载）

这导致三个问题：

1. **SOP 双路径**：`.snail/sop/` 同时存在 JSON（snail-loader）和 YAML（sop-loader）两条加载路径，格式不同、时机不同、写入策略不同。
2. **路径散落**：`.snail` 目录名和子目录结构的约定散落在 4 个文件中，改约定要改所有地方。
3. **无统一上下文**：没有"我已加载完这个 workspace 的所有 `.snail` 资源"的概念，各模块独立发现和加载。

## 目标

引入 `WorkspaceContext` 统一加载器，将 `.snail/` 下所有资源的加载收敛到一个入口：

### P1 — 统一加载入口

- 创建 `WorkspaceContext` 类型，包含 workspace 配置、SOP 定义、prompts、skills
- `loadWorkspaceContext(workspaceRoot)` 一次性加载 `.snail/` 下所有资源
- 共享路径常量集中定义，消除各模块自行拼接 `.snail/<subdir>` 的散落问题
- SOP 加载统一为 YAML 格式（与 I2026053104 对齐），移除 JSON 路径
- 各消费者（prompt-center、skill-center、sop-loader、manager、server）改为从 context 读取

## 非目标

- 不做 `.snail/` 变更监听或热加载（沿用 I2026052607 决策 #6）
- 不改 `prompt-center/builder.ts` 的 `PromptBuildContext` 接口签名（context 在 `buildConversationCapability` 内部按需加载）
- 不做缓存层（`.snail/` 文件小，IO 不是瓶颈）
- 不迁移平台级 `.meta/` 资源到 `.snail/`
- 不改变 `.snail/` 目录结构（workspace.json、sop/、prompts/、skills/）

## 设计

### P1 详设

#### WorkspaceContext 类型

```typescript
interface WorkspaceContext {
  workspaceRoot: string;
  config: { name: string; summary?: string; default_sop_key?: string };
  sopDefinitions: SopYamlDefinition[];  // .snail/sop/*.yaml，与 sop-loader.ts 格式对齐
  prompts: PromptDocument[];             // .snail/prompts/*.md
  skills: SkillDefinition[];             // .snail/skills/*/SKILL.md
}
```

#### 加载入口

`loadWorkspaceContext(workspaceRoot, options?)` 是唯一的 `.snail/` 加载入口：
- `options?.loadSopDefinitions` 控制是否加载 SOP（默认 true）
- 路径常量在 `snail-loader.ts` 中集中定义，其他模块通过导入使用

#### SOP 格式统一

- `.snail/sop/` 统一为 YAML 格式（与 `.meta/sop/` 一致）
- 移除 `snail-loader.ts` 中的 JSON SOP 解析函数（`loadSopConfigs`、`loadSingleSopConfig`、`parseRoleDefinitions`、`parseStageDefinitions` 等）
- `sop-loader.ts` 导出纯函数 `loadSopYamlDefinitions(dir)` 供统一加载器复用
- `loadWorkspaceFromSnail` 改为：加载 context → 用 context.sopDefinitions 写入 DB

#### 消费者改造

| 消费者 | 当前 | 改造后 |
|---|---|---|
| `prompt-center/registry.ts` `loadWorkspacePrompts(wsRoot)` | 自己扫描 `.snail/prompts/` | 接受 `WorkspaceContext`，从 context.prompts 读取 |
| `skill-center/registry.ts` `listSkillsWithWorkspace(wsRoot)` | 自己扫描 `.snail/skills/` | 接受 `WorkspaceContext`，从 context.skills 读取 |
| `prompt-center/builder.ts` `buildConversationCapability` | 调用上述两个函数 | 内部加载 context，传给 registry 函数 |
| `sop-loader.ts` `loadAllSopFiles` | 自己扫描 `.snail/sop/*.yaml` | 用 `loadSopYamlDefinitions` 统一解析 |
| `manager.ts` `loadWorkspaceFromSnail` | 用 JSON 路径 `loadSnailConfig` | 用 `loadWorkspaceContext` 获取 YAML SOP |
| `server.ts` detect-snail/load-snail | 直接调用 `loadSnailConfig` | 用 `loadWorkspaceContext` |

## 生效路径

- `src/workspace-workflow/snail-loader.ts`：统一加载入口 + 路径常量
- `src/persistence/sop-loader.ts`：导出纯函数 `loadSopYamlDefinitions`
- `src/skill-center/registry.ts`：API 签名变更
- `src/prompt-center/registry.ts`：API 签名变更
- `src/prompt-center/builder.ts`：内部使用统一加载器
- `src/workspace-workflow/manager.ts`：消费统一加载器
- `src/interaction-entry/api/server.ts`：消费统一加载器

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/workspace-workflow/snail-loader.ts` | 重构 | 添加 WorkspaceContext、loadWorkspaceContext、路径常量；移除 JSON SOP 解析 |
| `src/persistence/sop-loader.ts` | 修改 | 导出 loadSopYamlDefinitions 纯函数 |
| `src/skill-center/registry.ts` | 修改 | listSkillsWithWorkspace 改为接受 skills 数组 |
| `src/prompt-center/registry.ts` | 修改 | loadWorkspacePrompts 改为接受 context |
| `src/prompt-center/builder.ts` | 修改 | buildConversationCapability 内部加载 context |
| `src/workspace-workflow/manager.ts` | 修改 | loadWorkspaceFromSnail 使用统一加载器 |
| `src/interaction-entry/api/server.ts` | 修改 | detect-snail/load-snail 使用统一加载器 |

## 验证

### P1

- [x] TypeScript 编译通过
- [x] 现有测试通过
- [x] `loadWorkspaceContext` 能正确加载 `.snail/` 下所有资源
- [x] `loadWorkspaceFromSnail` 通过统一加载器将 SOP 写入 DB
- [x] `buildConversationCapability` 通过统一加载器获取 workspace prompts 和 skills
- [x] detect-snail API 返回正确的 workspace 配置

## 关联

- **前置**: I2026053103（`.snail` 目录结构定义）
- **前置**: I2026053104（SOP YAML 格式 + 模块隔离）
- **前置**: I2026052607（workspace prompt overlay loader）
- **前置**: I2026053002（workspace skill 加载）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | SOP 格式从 JSON 迁移到 YAML | 统一为 YAML，与 I2026053104 对齐。现有 `.snail/sop/*.json` 需手动迁移 | 2026-06-01 |
| 2 | WorkspaceContext 是否缓存 | 不缓存，每次按需加载。`.snail/` 文件小，IO 不是瓶颈 | 2026-06-01 |
| 3 | PromptBuildContext 是否增加 workspaceContext 字段 | 不增加。context 在 buildConversationCapability 内部按需加载，避免改调用链签名 | 2026-06-01 |
