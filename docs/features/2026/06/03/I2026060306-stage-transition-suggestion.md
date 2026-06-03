---
id: I2026060306
title: stage-transition-suggestion
from_ids: [I2026060303]
tags: []
modules: [workflow, web]
doc_kind: spec
---

# I2026060306 [workflow] AI 阶段转移建议：提议→用户确认→执行

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

阶段流转功能存在三个断裂点，导致整体流程无法闭环：

1. **AI 信号直接执行转移，用户无感知**：`scanAndExecuteStageTransition` 检测到 `stage_transition` 信号后直接调用 `transitionIssueStage`，用户没有任何确认环节。设计意图是 AI 判断工作完成后建议用户推进，用户点确认才执行。

2. **AI 缺少验收清单状态上下文**：`appendTransitionHint` 只注入可用转移目标，不注入 `acceptance_checklist` 完成状态和 `gate_evidence` 摘要。AI 无法判断"本阶段工作是否足够完成，可以建议转移"。

3. **`gate_evidence` 没有写入 API**：共享手册指引 AI 通过 `stage-gate` API 写入 `gate_evidence`，但 `PATCH /stages/:id` 的 `parseStageUpdates` 不解析 `gate_evidence` 字段，`WorkspaceManager.updateStage` 类型签名也不包含该字段。AI 无法持久化自检结果。

## 目标

### P1 — AI 建议→用户确认→执行

stage_transition 信号不再直接执行转移。后端存储为待确认建议，通过 WebSocket 推送到前端，前端显示横幅（建议目标 + 原因），用户点击确认后执行。

### P2 — gate_evidence 写入通道打通

`PATCH /stages/:id` 支持 `gate_evidence` 字段，AI 可通过 API 写入自检结果。

### P3 — AI 上下文增强

`appendTransitionHint` 注入当前 stage 的 gate 自检状态（passed/failed/skipped 数量），帮助 AI 判断是否建议转移。

## 非目标

- 不改变 SOP 转移图的结构和校验逻辑
- 不改变 gate_evidence 的 advisory 性质（不阻塞转移）
- 不实现多 issue 并发建议队列（每个 issue 最多一个 pending 建议）

## 设计

### P1 详设

**后端变更：**

`WorkspaceManager` 新增：
- `StageSuggestion` 接口：`{ issueId, fromStageKey, toStageKey, reason, suggestedAt }`
- `pendingStageSuggestions: Map<string, StageSuggestion>`（keyed by issueId）
- `handleAgentStageSuggestion`：替代原 `executeAgentStageTransition`，存储建议 + emit `"stage-suggestion"` 事件
- `getPendingStageSuggestion(issueId)`：REST 查询
- `confirmStageSuggestion(issueId)`：确认执行（转移失败保留建议）
- `clearStageSuggestion(issueId)`：拒绝/清除

`transitionIssueStage` 方法：workflow 成功后 delete suggestion（解决 bounce 后 stale 建议问题）。

**API 新增：**
- `GET /issues/:id/stage-suggestion` — 查询待确认建议
- `POST /issues/:id/confirm-stage-suggestion` — 确认并执行
- `POST /issues/:id/reject-stage-suggestion` — 拒绝

**WebSocket 新增：**
- `server.ts` 监听 `"stage-suggestion"` 事件，向 issue 关联的所有 conversation 客户端广播 `stage_suggestion` 消息类型
- 抽取 `broadcastToConversation` 辅助函数复用 badge 广播逻辑

**前端变更：**
- `realtime-manager.js`：处理 `stage_suggestion` 消息
- `stage-suggestion-banner.js`（新文件）：横幅 UI（建议目标 + 原因 + 确认/拒绝按钮）
- `stage-controller.js`：委托给 suggestion banner 模块
- `workspace-controller.js`：切换 issue 清理横幅 + REST fallback 检查待确认建议
- `app.js`：连接 `onStageSuggestion` 回调 + 注入 `stageTitle`

### P2 详设

`parseStageUpdates` 的 key 列表新增 `"gate_evidence"`。
`WorkspaceManager.updateStage` 类型签名新增 `gate_evidence`。

### P3 详设

`appendTransitionHint` 新增 `stage.id` 参数，从 `store.getStage(stage.id)` 读取 `gate_evidence`，注入 passed/failed/skipped 计数。无 evidence 时提示"尚未执行自检"。

## 生效路径

- `src/workspace-workflow/manager.ts` — 建议存储、确认、清除
- `src/workspace-workflow/manager-collaboration.ts` — 系统提示词 gate 状态注入
- `src/interaction-entry/api/issue-routes.ts` — 3 个新 REST 端点 + gate_evidence 写入
- `src/interaction-entry/api/server.ts` — WebSocket stage_suggestion 广播
- `src/message-bus/collaboration.ts` — 不修改（onStageTransitionDetected 回调签名已有 reason 参数）
- `src/web/stage-suggestion-banner.js` — 横幅 UI
- `src/web/stage-controller.js` — 委托层
- `src/web/realtime-manager.js` — WS 消息处理
- `src/web/workspace-controller.js` — issue 切换清理 + REST fallback
- `src/web/app.js` — 回调连接
- `src/web/styles/components/stage-suggestion.css` — 横幅样式

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/workspace-workflow/manager.ts` | `StageSuggestion` 接口、`pendingStageSuggestions` Map、`handleAgentStageSuggestion`、`getPendingStageSuggestion`、`confirmStageSuggestion`、`clearStageSuggestion`、`transitionIssueStage` 成功后 delete |
| `src/workspace-workflow/manager-collaboration.ts` | `appendTransitionHint` 增加 `stage.id` 参数 + gate_evidence 状态注入 |
| `src/interaction-entry/api/issue-routes.ts` | 新增 `registerStageSuggestionRoutes`（3 个端点）+ `parseStageUpdates` 支持 `gate_evidence` |
| `src/interaction-entry/api/server.ts` | `bindWebSocketServer` 新增 `workspaceManager` 参数、`broadcastToConversation` 辅助函数、`stage-suggestion` 监听 |
| `src/web/stage-suggestion-banner.js` | 新文件 — 横幅 UI（show/confirm/reject/clearState） |
| `src/web/stage-controller.js` | 导入 banner 模块、`setup` 初始化 banner、`showSuggestionBanner`/`clearSuggestionState` 委托、`stageTitle` property injection |
| `src/web/realtime-manager.js` | `handleMessage` 新增 `stage_suggestion` 分支 |
| `src/web/workspace-controller.js` | `selectIssue` 新增 `clearSuggestionState` + `checkPendingStageSuggestion` |
| `src/web/app.js` | realtime 新增 `onStageSuggestion` 回调 + `stageController.stageTitle` 注入 |
| `src/web/styles.css` | 导入 `stage-suggestion.css` |
| `src/web/styles/components/stage-suggestion.css` | 新文件 — 横幅样式 |

## 验证

### P1

- [ ] AI 输出 `stage_transition` JSON 后，前端显示转移建议横幅（含目标阶段名称和原因）
- [ ] 点击"确认推进"执行转移，阶段正确切换，新 conversation 创建
- [ ] 点击"忽略"清除建议，后端 Map 删除
- [ ] 转移失败时建议保留（可通过再次确认重试）
- [ ] bounce 后旧建议自动清除
- [ ] 切换 issue 时横幅清除
- [ ] 刷新页面后 REST fallback 恢复待确认建议
- [ ] 归档 issue 上的 AI 建议被静默忽略（log.warn）

### P2

- [ ] `PATCH /stages/:id` 可写入 `gate_evidence` 字段
- [ ] 写入后 `store.getStage` 可读回 `gate_evidence`

### P3

- [ ] 系统提示词包含 gate 自检状态摘要（有 evidence 时显示 passed/failed/skipped 计数）
- [ ] 无 evidence 时显示"尚未执行自检，建议在提议转移前完成验收清单自查"

### 通用

- [ ] TypeScript 编译无错误
- [ ] ESLint 无错误
- [ ] 现有测试不回归
