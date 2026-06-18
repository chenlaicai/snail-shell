---
id: F2026061704
title: pr375-ui-rebuild-adaptation
from_ids:
  - F2026060901
  - F2026061601
tags:
  - web
  - ui
  - issue-board
  - issue-conversation
  - linear-style
  - stage
modules:
  - web
doc_kind: spec
---

# F2026061704 [web][Feature] PR #375 UI 设计重建适配

## 背景

当前 `origin/main` 已经完成 Stage Source of Truth 重构，但 UI 层处于新旧混杂状态：

- `globals.css` 同时存在 Tailwind v4 `@theme inline` token 与旧 `:root` CSS 变量。
- Issue 看板仍由旧 `WorkspaceBoard.tsx` 承载，卡片和工具栏样式保留大量旧变量。
- Issue 对话页仍由 `ConversationLayout.tsx` + `ConversationView.tsx` + `ContextPanel.tsx` + `MessageRenderer.tsx` 组合实现，结构复杂且与 PR #375 的 Linear 风格不一致。
- PR #375 的核心 UI 组件（`TopBar`、`Sidebar`、`IssueCard`、`ChatMessage`、`ChatInput`、`PropertiesPanel` 等）并未落地。

本次改动的目标不是修改后端数据模型，而是以 PR #375 的 UI 设计为初稿，适配当前后端已经确定的 Stage 数据模型和 `/workspaces` 路由体系。

## 设计原则

### 1. 后端模型与路由以当前 main 为准

PR #375 曾假设 `/ws/:id/board` 与 conversation-oriented 前端模型；当前 main 的真实契约是：

- Workspace 路由为 `/workspaces/:workspaceId/...`。
- Issue 对话依附当前 `StageDetailDto`。
- 消息接口为 `GET /api/stages/:stageId/messages` 与 `POST /api/stages/:stageId/messages`。
- 当前可写上下文由 `issue.current_stage` 决定。

因此本次 UI 重建只迁移视觉和组件结构，不引入新的后端抽象。

### 2. PR #375 作为整体 UI 初稿，而不是碎片化迁移

此前增量迁移会留下旧布局、旧 CSS 变量和旧渲染器残留。本次采用整体替换策略：

- 新建 Linear 风格组件层。
- 用新 `IssueBoard` / `IssueList` / `IssueConversation` 替换旧 workspace/issue 页面。
- 简化 `AppShell` 为 `Sidebar + Outlet`。
- 删除旧对话页、旧消息渲染器和旧 workspace 看板。

### 3. 视觉替换必须保留 latest main 的核心交互

PR #375 只作为视觉初稿，交互语义必须继承当前 main：

- 新建 Issue 必须完成 SOP stage preview 与 role instance → snail assignment plan。
- Issue 对话必须接入 `useIssueRealtime(issueId, stageId)`，保持流式消息与 stage suggestion 实时更新。
- 当前 stage 必须由 URL `?stage=` + issue detail 派生，支持刷新和分享。
- Stage advance / transition suggestion 是核心工作流，不能降级为假按钮。
- 全站旧 `var(--*)` 样式变量必须迁移到新 token，不保留兼容层。

## 改动概览

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/web/globals.css` | 重构 | 移除旧 `:root` 变量，保留 PR #375 的 `@theme inline` token |
| `src/web/layouts/AppShell.tsx` | 重构 | 简化为 `Sidebar + Outlet` |
| `src/web/components/Sidebar.tsx` | 新增 | Linear 风格全局侧边栏，工作区入口指向 `/workspaces/:id/board` |
| `src/web/components/TopBar.tsx` | 新增 | 面包屑顶部栏 |
| `src/web/components/IssueCard.tsx` | 新增 | 看板 Issue 卡片 |
| `src/web/components/IssueRow.tsx` | 新增 | 列表 Issue 行 |
| `src/web/components/StatusBadge.tsx` | 新增 | Stage 状态徽章 |
| `src/web/components/ChatMessage.tsx` | 新增 | 消息气泡与事件流折叠展示，适配当前 `MessageDto.payload.type` |
| `src/web/components/ChatInput.tsx` | 新增 | 对话输入框 |
| `src/web/components/PropertiesPanel.tsx` | 新增 | Issue 右侧属性面板 |
| `src/web/components/NewIssueDialog.tsx` | 新增 | 新建 Issue 弹窗，适配当前创建接口 |
| `src/web/components/StageActionBar.tsx` | 新增 | 新样式 Stage 推进操作 |
| `src/web/components/StageSuggestionCard.tsx` | 新增 | 新样式 Stage transition suggestion 确认卡片 |
| `src/web/components/RichTextRenderer.tsx` | 新增 | Markdown/code/link/Mermaid 富文本渲染 |
| `src/web/components/ToolApprovalCard.tsx` | 新增 | 工具审批卡片组件，暂未自动挂载 |
| `src/web/pages/WorkspaceDirectory.tsx` | 新增 | 新样式 workspace 列表入口 |
| `src/web/pages/WorkspaceConfig.tsx` | 新增 | 新样式 workspace 创建入口 |
| `src/web/pages/IssueBoard.tsx` | 新增 | 新看板页 |
| `src/web/pages/IssueList.tsx` | 新增 | 新列表页 |
| `src/web/pages/IssueConversation.tsx` | 新增 | 新对话页，使用当前 stage API |
| `src/web/router.tsx` | 重构 | 注册新路由，移除旧 workspace 页面入口 |
| 旧 UI 文件 | 删除 | 移除旧对话页、旧看板、旧渲染器、旧侧边栏树等 |

## 路由协议

| 路由 | 页面 | 说明 |
|------|------|------|
| `/workspaces` | `WorkspaceDirectory` | Workspace 列表入口 |
| `/workspaces/new` | `WorkspaceConfig` | Workspace 创建入口 |
| `/workspaces/:workspaceId/board` | `IssueBoard` | Workspace Issue 看板 |
| `/workspaces/:workspaceId/list` | `IssueList` | Workspace Issue 列表 |
| `/workspaces/:workspaceId/issue/:issueId` | `IssueConversation` | Issue 对话页 |

侧边栏统一指向 `/workspaces/:workspaceId/board`；首页 CTA 保持 `/workspaces` 与 `/workspaces/new` 有效。

## 数据适配

### Issue Board/List

- Workspace 名称使用 `WorkspaceDto.path`，当前 DTO 不提供 `name`。
- Issue 更新时间当前 DTO 不提供 `updated_at`，卡片和列表使用 `created_at` 作为时间展示。
- 分组基于 `issue.current_stage.status`；current stage 被视为 issue 的业务不变量，后端若无法提供该字段应直接报错而不是下放到 UI 容错。

### Issue Conversation

- 当前对话上下文由 URL `?stage=` + issue detail 派生；无有效 URL stage 时 fallback 到 `issue.current_stage`，不把无 current stage 视为合法状态。
- 页面调用 `useIssueRealtime(issueId ?? null, stageId)`，恢复 `message_started`、`message_event_appended`、`message_status_changed`、`stage_transition_suggested` 实时更新。
- 消息读取 `GET /api/stages/:stageId/messages`。
- 消息发送 `POST /api/stages/:stageId/messages`，并沿用 `createPlaceholderMessage` 做乐观插入。
- `ChatMessage` 将 PR #375 的 `event.kind` 访问适配为当前 `MessageEvent.payload.type`。
- Stage suggestion 读取 `GET /api/stages/:stageId/transition-suggestions`，确认后调用 `POST /api/stages/:stageId/advance` 并更新 issue cache 与 URL。

### Issue Creation

- 新建 Issue 恢复旧 `WorkspaceBoard` 的完整契约：加载 SOP、加载 snail-den、选择 SOP 后加载 stage previews。
- 前端为每个 `stage.key / role_instance` 生成 `snail_assignment_plan`，提交前校验缺失 assignment。
- 创建成功后跳转 `/workspaces/:workspaceId/issue/:issueId?stage=:stageId`。

### 全站样式

- `src/web` 下旧 `var(--color-*)`、`var(--space-*)`、`var(--font-size-*)`、`var(--radius-button)` 等引用已清零。
- `HomePage`、`EvolutionCenter`、`KnowledgeLibrary`、`SopCenter`、`PromptCenter`、`SkillCenter`、`SnailDen`、`McpCenter`、`Lobby`、`NotFound`、`ErrorBoundary`、`QueryState`、`Toast`、`ui/dialog` 已迁移到新 token。

## 删除的旧实现

删除以下已被新 UI 替换的旧文件：

- `ConversationLayout.tsx`
- `ConversationView.tsx`
- `WorkspaceBoard.tsx`
- `ContextPanel.tsx`
- `MessageRenderer.tsx`
- `MarkdownRenderer.tsx`（能力迁移到 `RichTextRenderer.tsx`）
- `MermaidDiagram.tsx`（能力迁移到 `RichTextRenderer.tsx`）
- `StageActions.tsx`
- `StageSuggestionBanner.tsx`
- `Sidebar/WorkspaceTree.tsx`
- `useMention.ts`
- `useCurrentStage.ts`

## 验证

- `git grep "var(--color-\|var(--space-\|var(--font-size-\|var(--radius-button" -- src/web` 无结果。
- `npm run build` 通过（包含 lint、tsc、tsc-alias、build:web）。
- `build:web` 通过；Mermaid 动态 import 会产生分块和体积 warning，但不阻塞。

## 后续事项

1. 根据后端工具审批协议，将 `ToolApprovalCard` 挂载到真实 permission-required 消息。
2. 如需保留 `/workspaces/:workspaceId` 兼容入口，可增加 redirect 到 `/workspaces/:workspaceId/board`。
