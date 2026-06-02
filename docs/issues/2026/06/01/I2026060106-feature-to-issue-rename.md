---
id: I2026060106
title: feature-to-issue-rename
from_ids: [I2026060104]
tags: [refactor, naming, incompatible]
modules: [persistence, workspace-management, prompt, workflow]
doc_kind: spec
---

# I2026060106 Feature 改为 Issue：扩大 Workspace 下顶层工作项定义

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

`project` 已重命名为 `workspace`，但 workspace 下的顶层工作项仍叫 "feature"。实际上 workspace 下新建的不一定是代码特性——可能是话题探讨、技术调研、论文分析、装修建议等。"feature" 作为容器概念过于狭窄，需要一个更通用的术语。

用户确认选用 **issue** 作为 workspace 下所有工作项的通用容器名。Feature 作为 issue 的子类型仍然存在（通过 tag 或 kind 区分），但顶层概念从 "feature" 扩展为 "issue"。

## 目标

### P1 — 核心模型重命名

将 "feature" 作为 Snail Shell 领域概念替换为 "issue"，覆盖以下层次：

1. **ID 格式**：`FYYYYMMDDNN` → `IYYYYMMDDNN`
2. **文档目录**：`docs/features/` → `docs/issues/`
3. **数据库表名和列名**：`feature` → `issue`，`feature_id` → `issue_id`，`feature_chain_*` → `issue_chain_*`
4. **代码类型和方法**：`Feature` → `Issue`，`createFeature()` → `createIssue()` 等
5. **API 路由**：`/features/` → `/issues/`
6. **CLI 命令和 skill**：`feature-chain` → `issue-chain`，`record-feature-repo-context` → `record-issue-repo-context`
7. **Prompt 模板变量**：`feature_id` → `issue_id`，`feature_title` → `issue_title` 等
8. **Commit 模板标签**：`[New Feature]` → `[New Issue]`，`[Feature Update]` → `[Issue Update]`

### P2 — 文档与历史迁移

1. 已有 117 个 feature 文档迁移至 `docs/issues/`，文件名前缀从 `F` 改为 `I`
2. 所有 `from_ids` 中的 `FYYYYMMDDNN` 引用改为 `IYYYYMMDDNN`
3. feature-chain 索引重建

## 非目标

- 不改变 issue 的生命周期（stage-driven workflow 不变）
- 不引入 issue type/kind 字段（本 feature 只做重命名，类型区分留后续）
- 不改变 stage、conversation 等其他领域概念的命名
- 不处理第三方依赖或外部库中的 feature 引用

## 实施策略

**单 PR 原子提交**。所有代码、路由、prompt、skill、脚本变更在同一个 PR 中完成，因为系统无法在半重命名状态下正常运行。文档迁移（P2）作为同一 PR 的后续 commit。

## 设计

### P1 详设：重命名映射

#### 数据库

| 原名 | 新名 | 类型 |
|---|---|---|
| `feature` 表 | `issue` 表 | 表重命名 |
| `feature.id` | `issue.id` | 列 |
| `feature.workspace_id` | `issue.workspace_id` | 列 |
| `feature_chain_index` 表 | `issue_chain_index` 表 | 表重命名 |
| `feature_chain_index.feature_id` | `issue_chain_index.issue_id` | 列 |
| `feature_chain_search` 表 | `issue_chain_search` 表 | FTS5 虚拟表（需 drop+recreate） |
| `feature_chain_backlink` 表 | `issue_chain_backlink` 表 | 表重命名 |
| `feature_chain_backlink.feature_id` | `issue_chain_backlink.issue_id` | 列 |
| `feature_chain_backlink.from_feature_id` | `issue_chain_backlink.from_issue_id` | 列 |
| `stage.feature_id` | `stage.issue_id` | FK 列 |
| `conversation.feature_id` | `conversation.issue_id` | FK 列 |
| `evolution_item.feature_id` | `evolution_item.issue_id` | FK 列 |
| `lobby_session.current_feature_id` | `lobby_session.current_issue_id` | FK 列 |

索引名同步更新：
- `idx_feature_workspace_closed` → `idx_issue_workspace_closed`
- `idx_stage_feature_sequence` → `idx_stage_issue_sequence`
- `idx_conversation_feature_stage` → `idx_conversation_issue_stage`
- `idx_evolution_item_feature` → `idx_evolution_item_issue`
- `idx_feature_chain_backlink_from` → `idx_issue_chain_backlink_from`

schema.ts 中 initSchema 只允许 `CREATE TABLE IF NOT EXISTS`。由于表名变更，新旧表可以共存。数据迁移由人手工完成（INSERT INTO issue SELECT * FROM feature 等），代码仓不保留自动迁移逻辑。

#### 代码

| 原名 | 新名 | 文件 |
|---|---|---|
| `Feature` 接口 | `Issue` 接口 | `domain-types.ts` |
| `FeatureDetail` | `IssueDetail` | `manager-types.ts` |
| `FeatureWorkflowResult` | `IssueWorkflowResult` | `workflow.ts` |
| `FeatureAdvanceResult` | `IssueAdvanceResult` | `workflow.ts` |
| `FeatureDoc` | `IssueDoc` | `indexer.ts` |
| `FeatureLinkUpdate` | `IssueLinkUpdate` | `indexer.ts` |
| `createFeature()` | `createIssue()` | `store.ts`, `manager.ts` |
| `getFeature()` | `getIssue()` | `store.ts`, `manager.ts` |
| `listFeatures()` | `listIssues()` | `store.ts`, `manager.ts` |
| `updateFeature()` | `updateIssue()` | `store.ts` |
| `advanceFeature()` | `advanceIssue()` | `manager.ts` |
| `bounceFeatureStage()` | `bounceIssueStage()` | `manager.ts` |
| `setFeatureTaskAnchor()` | `setIssueTaskAnchor()` | `manager.ts` |
| `setFeatureRoleSnail()` | `setIssueRoleSnail()` | `manager.ts` |
| `completeFeature()` | `completeIssue()` | `manager.ts` |
| `archiveFeature()` | `archiveIssue()` | `manager.ts` |
| `listFeatureConversations()` | `listIssueConversations()` | `manager.ts` |
| `listStagesByFeature()` | `listStagesByIssue()` | `store.ts` |
| `listConversationsByFeature()` | `listConversationsByIssue()` | `store.ts` |
| `rebuildFeatureChainIndex()` | `rebuildIssueChainIndex()` | `store.ts` |
| `buildFeature()` | `buildIssue()` | `builder.ts` |
| `feature_title` 变量 | `issue_title` | `builder.ts` |
| `feature_summary` 变量 | `issue_summary` | `builder.ts` |
| `feature_id` 变量 | `issue_id` | `builder.ts` |
| `feature_task_anchor_block` 变量 | `issue_task_anchor_block` | `builder.ts` |
| `InvocationSubject.featureId` | `InvocationSubject.issueId` | `domain-types.ts` |
| `WorkspaceSummary.feature_count` | `WorkspaceSummary.issue_count` | `manager-types.ts` |
| `WorkspaceDetail.features` | `WorkspaceDetail.issues` | `manager-types.ts` |
| `NavigationContext.feature` | `NavigationContext.issue` | `lobby/types.ts` |
| `LobbySession.current_feature_id` | `LobbySession.current_issue_id` | `lobby/types.ts` |

#### Lobby 模块

| 原名 | 新名 | 文件 |
|---|---|---|
| `"feature_list"` navigation level | `"issue_list"` | `lobby/types.ts` |
| `LobbySession.current_feature_id` | `LobbySession.current_issue_id` | `lobby/types.ts` |
| `LobbyCommandType "features"` | `"issues"` | `lobby/types.ts` |
| `LobbyStatusContext.feature` | `LobbyStatusContext.issue` | `lobby/types.ts` |
| `handleFeatures()` | `handleIssues()` | `lobby/command-executor.ts` |
| `renderFeatureList()` | `renderIssueList()` | `lobby/response-renderer.ts` |
| `renderEnterSuccess(featureTitle)` | `renderEnterSuccess(issueTitle)` | `lobby/response-renderer.ts` |
| `/features <workspace_id>` 命令 | `/issues <workspace_id>` | `lobby/response-renderer.ts` help |
| `/enter <feature_id>` 帮助文本 | `/enter <issue_id>` | `lobby/response-renderer.ts` help |
| `"Feature 列表"` 导航显示 | `"Issue 列表"` | `lobby/response-renderer.ts` |

#### db-bridge 脚本

| 原 CLI mode | 新 CLI mode |
|---|---|
| `feature-chain-search` | `issue-chain-search` |
| `feature-chain-get` | `issue-chain-get` |
| `feature-chain-chain` | `issue-chain-chain` |
| `feature-set-task-anchor` | `issue-set-task-anchor` |
| `stage-record-context` 中 `feature_id`/`feature_title` 返回值 | `issue_id`/`issue_title` |
| `context-query` 中 `feature` 行读取 | `issue` 行读取 |
| `evolution-create` 中 `feature` 表插入 | `issue` 表插入 |

#### 文件重命名

| 原文件 | 新文件 |
|---|---|
| `src/interaction-entry/api/feature-routes.ts` | `src/interaction-entry/api/issue-routes.ts` |
| `src/web/feature-list-view.js` | `src/web/issue-list-view.js` |
| `src/web/feature-readonly-state.js` | `src/web/issue-readonly-state.js` |
| `src/web/feature-workflow-state.js` | `src/web/issue-workflow-state.js` |
| `src/feature-chain/indexer.ts` | `src/issue-chain/indexer.ts` |
| `src/feature-chain/` 目录 | `src/issue-chain/` 目录 |

#### API 路由

| 原路由 | 新路由 |
|---|---|
| `POST /workspaces/:workspaceId/features` | `POST /workspaces/:workspaceId/issues` |
| `GET /features/:featureId` | `GET /issues/:issueId` |
| `GET /features/:featureId/stages` | `GET /issues/:issueId/stages` |
| `GET /features/:featureId/conversations` | `GET /issues/:issueId/conversations` |
| `POST /features/:featureId/advance` | `POST /issues/:issueId/advance` |
| `POST /features/:featureId/bounce-stage` | `POST /issues/:issueId/bounce-stage` |
| `PATCH /features/:featureId/task-anchor` | `PATCH /issues/:issueId/task-anchor` |
| `PATCH /features/:featureId/role-snail` | `PATCH /issues/:issueId/role-snail` |
| `POST /features/:featureId/complete` | `POST /issues/:issueId/complete` |
| `POST /features/:featureId/archive` | `POST /issues/:issueId/archive` |
| `POST /features/:featureId/stages/:stageId/conversations` | `POST /issues/:issueId/stages/:stageId/conversations` |

#### Skill 重命名

| 原名 | 新名 |
|---|---|
| `.meta/skills/feature-chain/` | `.meta/skills/issue-chain/` |
| `.meta/skills/record-feature-repo-context/` | `.meta/skills/record-issue-repo-context/` |
| `feature-chain-search` CLI mode | `issue-chain-search` |
| `feature-chain-get` CLI mode | `issue-chain-get` |
| `feature-chain-chain` CLI mode | `issue-chain-chain` |
| `feature-set-task-anchor` CLI mode | `issue-set-task-anchor` |

`set-task-anchor` skill 保持不变（名称不含 feature）。

#### Commit 模板

`[Feature Update]` → `[Issue Update]`，`[New Feature]` → `[New Issue]`。

`[BugFix]` 和 `[Incompatible]` 不受影响。

### P2 详设：文档迁移

1. 目录移动：`docs/features/YYYY/MM/DD/` → `docs/issues/YYYY/MM/DD/`
2. 文件重命名：`FYYYYMMDDNN-*.md` → `IYYYYMMDDNN-*.md`
3. Frontmatter `id` 字段：`FYYYYMMDDNN` → `IYYYYMMDDNN`
4. 文档内 `from_ids` 引用：`FYYYYMMDDNN` → `IYYYYMMDDNN`
5. 文档内其他 "feature" 引用（正文描述）→ "issue"
6. feature-chain 索引表需要 drop+recreate 并重建

## 生效路径

- 数据库 schema（`src/persistence/schema.ts`）
- 代码类型、方法、路由（`src/` 全栈）
- Prompt 模板和行为规则（`.meta/prompts/`）
- Skill 定义和脚本（`.meta/skills/`）
- Commit 模板（`.meta/prompts/prompts/S-03-开发者手册.md`）
- 文档目录结构（`docs/`）

<!-- [design-time] 章节结束 -->

## 改动范围

（实现阶段填写）

## 验证

### P1
- [ ] TypeScript 编译通过
- [ ] 现有测试全部通过
- [ ] 新 schema 创建成功（新表名生效）
- [ ] API 路由全部切换到 `/issues/`
- [ ] Prompt 模板变量正确替换

### P2
- [ ] 117 个文档全部迁移至 `docs/issues/`
- [ ] `from_ids` 引用链完整
- [ ] issue-chain 索引重建成功
- [ ] `issue-chain-search` CLI 正常工作

### 通用
- [ ] 全仓无残留的领域级 "feature" 引用（排除第三方依赖和通用英语用法）
- [ ] lobby `/features` 命令改为 `/issues`
- [ ] web UI 功能正常

## 关联

- **前置**: I2026060104（project→workspace 残留清理，确立了术语重命名的模式）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | ID 前缀从 F 改为 I，历史引用链如何处理 | 全量迁移：文档内 from_ids 和索引表全部更新为 I 前缀 | 2026-06-01 |
| 2 | 数据库表名变更，schema.ts 只允许 CREATE IF NOT EXISTS | 新旧表名可共存，数据迁移由人手工完成 | 2026-06-01 |
| 3 | FTS5 虚拟表不支持 ALTER TABLE | 需要 DROP + CREATE，由人手工完成 | 2026-06-01 |
| 4 | commit 标签 [Feature Update] 是否改为 [Issue Update] | 改为 [Issue Update] / [New Issue]，保持领域术语一致 | 2026-06-01 |
| 5 | `set-task-anchor` skill 名称不含 feature | 保持不变 | 2026-06-01 |
