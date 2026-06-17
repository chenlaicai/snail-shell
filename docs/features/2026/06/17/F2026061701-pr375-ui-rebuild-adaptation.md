---
id: F2026061701
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

# F2026061701 [web][Feature] PR #375 UI 设计重建适配

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

### 3. 先建立视觉一致性，再逐步补齐高级交互

本次聚焦 issue 看板与 issue 对话界面的基础视觉结构。以下交互保留后续优化空间：

- 新建 Issue 仍需当前后端要求的 `snail_assignment_plan`，当前 UI 先保留 SOP 选择并传空 assignment plan，完整 role instance → snail 分配可后续补回。
- 工具审批卡片组件已保留，但当前 `MessageStatus` 未包含 `pending_approval`，暂不在对话页自动挂载。
- Stage advance/complete 操作在新对话页先保留视觉按钮，后续接入现有 mutation 与缓存更新策略。

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
| `src/web/components/ToolApprovalCard.tsx` | 新增 | 工具审批卡片组件，暂未自动挂载 |
| `src/web/pages/IssueBoard.tsx` | 新增 | 新看板页 |
| `src/web/pages/IssueList.tsx` | 新增 | 新列表页 |
| `src/web/pages/IssueConversation.tsx` | 新增 | 新对话页，使用当前 stage API |
| `src/web/router.tsx` | 重构 | 注册新路由，移除旧 workspace 页面入口 |
| 旧 UI 文件 | 删除 | 移除旧对话页、旧看板、旧渲染器、旧侧边栏树等 |

## 路由协议

| 路由 | 页面 | 说明 |
|------|------|------|
| `/workspaces/:workspaceId/board` | `IssueBoard` | Workspace Issue 看板 |
| `/workspaces/:workspaceId/list` | `IssueList` | Workspace Issue 列表 |
| `/workspaces/:workspaceId/issue/:issueId` | `IssueConversation` | Issue 对话页 |

旧 `/workspaces/:workspaceId` 入口不再作为主看板入口，侧边栏统一指向 `/workspaces/:workspaceId/board`。

## 数据适配

### Issue Board/List

- Workspace 名称使用 `WorkspaceDto.path`，当前 DTO 不提供 `name`。
- Issue 更新时间当前 DTO 不提供 `updated_at`，卡片和列表使用 `created_at` 作为时间展示。
- 分组基于 `issue.current_stage?.status`，无 current stage 的 issue 归入 `unknown`，当前看板列只显示 `in_progress` 与 `completed`。

### Issue Conversation

- 当前对话上下文由 `issue.current_stage ?? issue.stages[0]` 派生。
- 消息读取 `GET /api/stages/:stageId/messages`。
- 消息发送 `POST /api/stages/:stageId/messages`，并沿用 `createPlaceholderMessage` 做乐观插入。
- `ChatMessage` 将 PR #375 的 `event.kind` 访问适配为当前 `MessageEvent.payload.type`。

## 删除的旧实现

删除以下已被新 UI 替换的旧文件：

- `ConversationLayout.tsx`
- `ConversationView.tsx`
- `WorkspaceBoard.tsx`
- `WorkspaceConfig.tsx`
- `WorkspaceDirectory.tsx`
- `ContextPanel.tsx`
- `MessageRenderer.tsx`
- `MarkdownRenderer.tsx`
- `MermaidDiagram.tsx`
- `StageActions.tsx`
- `StageSuggestionBanner.tsx`
- `Sidebar/WorkspaceTree.tsx`
- `useMention.ts`
- `useCurrentStage.ts`

## 验证

- `npx vite build --config src/web/vite.config.ts` 通过。
- CSS 产物从约 `46.62 kB` 降至约 `41.03 kB`。
- JS 产物从约 `477.21 kB` 降至约 `475.11 kB`。

## 后续事项

1. 补回完整新建 Issue 的 role instance → snail assignment UI。
2. 将 Stage advance/complete 按钮接入 mutation 与缓存更新。
3. 根据后端工具审批协议，将 `ToolApprovalCard` 挂载到真实 permission-required 消息。
4. 如需保留 `/workspaces/:workspaceId` 兼容入口，可增加 redirect 到 `/workspaces/:workspaceId/board`。
