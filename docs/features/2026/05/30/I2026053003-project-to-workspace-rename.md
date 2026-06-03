---
id: I2026053003
title: project-to-workspace-rename
from_ids: []
tags: [rename, breaking-change, domain-model]
modules: [persistence, workspace-workflow, interaction-entry, web, lobby, prompt-center, roles]
doc_kind: spec
---

# I2026053003 [persistence] 顶层实体 project 全量重命名为 workspace

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

Snail Shell 的顶层组织实体当前命名为 "project"，但实际使用场景已超越软件研发：research、讨论、灵感探索等流程都应在同一顶层空间内进行。"project" 隐含交付物、里程碑、截止时间的预期，与 Snail Shell 作为"人+AI 协作空间"的定位不符。

每个顶层实体以一个本地目录为核心锚点（`workspace_root`），包含代码、配置覆盖（`.snail/prompts/`）、agent 环境（`.claude/`/`.codex/`），worktree 从其派生——这正是 "workspace" 的标准含义。

## 目标

将代码仓中所有层级的 "project" 命名统一替换为 "workspace"，使领域模型语义与实际使用场景一致。

## 非目标

- 不做数据迁移——用户需手工重建 SQLite 表结构
- 不做兼容层、过渡逻辑或 API 重定向
- 不修改已合入的历史 feature 文档（它们是历史交付记录）

## 设计

### 重命名映射

| 层级 | 旧名 | 新名 |
|------|------|------|
| DB 表 | `project` | `workspace` |
| DB 表 | `project_sop` | `workspace_sop` |
| DB 列 | `project_id`（6 表） | `workspace_id` |
| DB 列 | `project_root` | `workspace_root` |
| DB 列 | `project.module` default `'project_management'` | `'workspace_management'` |
| DB 列 | `conversation.owner_type` default `'project_stage'` | `'workspace_stage'` |
| DB 列 | `sop.scope` / `knowledge_library.scope` 值 `'project'` | `'workspace'` |
| DB 列 | `lobby_session.current_project_id` | `current_workspace_id` |
| DB index | 含 project 的索引名 | 对应替换 |
| TS 类型 | `Project` | `Workspace` |
| TS 类型 | `ProjectModule` | `WorkspaceModule` |
| TS 类型 | `ProjectStatus` | `WorkspaceStatus` |
| TS 类型 | `ProjectStageDefinition` | `WorkspaceStageDefinition` |
| TS 类型 | `ProjectSop` | `WorkspaceSop` |
| TS 类型 | `ProjectManager` | `WorkspaceManager` |
| TS 类型 | `ProjectManagerDeps` | `WorkspaceManagerDeps` |
| TS 类型 | `ProjectSummary` | `WorkspaceSummary` |
| TS 类型 | `ProjectDetail` | `WorkspaceDetail` |
| TS 类型 | `ProjectSeedItem` / `ProjectConfigSeed` | `WorkspaceSeedItem` / `WorkspaceConfigSeed` |
| TS 类型 | `SeedSelfProjectResult` | `SeedSelfWorkspaceResult` |
| TS string | `"project_management"` | `"workspace_management"` |
| TS string | `"project_stage"` | `"workspace_stage"` |
| TS string | `"project_list"` | `"workspace_list"` |
| TS string | `"projects"` (command/view) | `"workspaces"` |
| TS string | `"project"` (scope/layer) | `"workspace"` |
| API 路径 | `/api/projects/*` | `/api/workspaces/*` |
| 目录 | `src/project-workflow/` | `src/workspace-workflow/` |
| 目录 | `tests/project/` | `tests/workspace/` |
| 文件 | `project-config-model.ts` | `workspace-config-model.ts` |
| 文件 | `self-project-seed.ts` | `self-workspace-seed.ts` |
| 文件 | `default-project-dir.ts` | `default-workspace-dir.ts` |
| 文件 | `project-config-seed.json` | `workspace-config-seed.json` |
| 文件 | `seed-self-project.ts` | `seed-self-workspace.ts` |
| CSS class | `.project-config-*`, `.tree-project*`, `.project-list` | `.workspace-config-*`, `.tree-workspace*`, `.workspace-list` |
| 模板变量 | `{{project_name}}` 等 | `{{workspace_name}}` 等 |
| 提示词 | `S-01-项目上下文.md` | `S-01-工作区上下文.md` |
| UI 文案 | "项目" / "新建项目" / "项目列表" | "工作区" / "新建工作区" / "工作区列表" |

### 不变项

- 已合入的历史 feature 文档不修改
- seed 数据中的 ID 值（`"snail-shell"`, `"evolution-center"`）不变
- SOP 定义内容不变（仅 scope 值从 `"project"` 改为 `"workspace"`）
- `.meta/prompts/reference/` 中的参考约束不改（非本次范围）

<!-- [design-time] 章节结束 -->

## 改动范围

预计修改 70+ 文件，覆盖：
- `src/persistence/` — schema, store, models, helpers, types
- `src/shared/` — domain-types, evolution-types, knowledge-library-types, types, index
- `src/project-workflow/` → `src/workspace-workflow/` — manager, workflow, types, seed, dir
- `src/interaction-entry/api/` — server, feature-routes, evolution-routes, lobby-routes
- `src/web/` — app, project-tree-view, project-config-view, workspace-context, primary-view, lobby-view, evolution-center, feature-list-view, styles
- `src/lobby/` — command-executor, types, session-store, response-renderer, command-parser
- `src/prompt-center/` — registry, builder, index
- `src/roles/` — registry
- `src/agent/` — guard-config
- `src/message-bus/` — collaboration
- `src/evolution-center/` — evolution-prompt
- `src/main.ts`, `src/index.ts`
- `.meta/` — project-config-seed.json, scripts, skills, prompt-evaluations
- `.meta/prompts/prompts/` — S-01
- `tests/` — 17 test files + directories
- `docs/` — README, user-manual, feature docs (仅新建)

## 验证

### P1 — 编译通过
- [ ] `npx tsc --noEmit` 无类型错误

### P2 — 测试通过
- [ ] `npm test` 全部通过

### P3 — 文本残留检查
- [ ] `grep -r "project" src/ --include="*.ts" --include="*.js" --include="*.css"` 无遗漏的领域概念引用（仅保留注释中的历史说明）

## 关联

- 无前置 feature（本次为独立重命名）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 不做数据迁移，用户需手工重建表 | 用户确认：只追求代码最新一致 | 2026-05-30 |
| 2 | 历史 feature 文档中的 "project" 是否修改 | 不修改已合入文档，它们是历史记录 | 2026-05-30 |
