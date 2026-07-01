---
id: F20260701b3qx
title: Board 实时刷新根因分析与修复
from_ids: [F20260626bxqf, F20260629smrx]
tags: [bugfix, websocket, board, realtime, observability]
modules: [web, collaboration]
---
# Board 实时刷新根因分析与修复

**编号**：F20260701b3qx
**状态**：development
**变更类型**：bugfix
**创建**：2026-07-01

## 问题

Issue Board 页面仍然没有实时刷新。用户反馈"反反复复好几天了"、"不刷新就还是不会自动刷新页面"。

此前已合入三个修复：
- F20260626bxqf（06-26）：原始实现 — Workspace 级 WebSocket + `useWorkspaceRealtime` hook
- F20260629smrx（06-29）：Vite proxy 补齐 + WebSocket 架构合并为 `unified-websocket.ts`
- #508（06-30）：base64url workspaceId 解码修复

三个修复均已合入 main，但问题仍然存在。

## 根因分析

### 完整数据流追踪

```
collaboration.ts:notifyConsumers()
  → getActivityStatus() 计算新状态
  → 与 lastActivityStatus 比较，有变化才通知
  → workspaceConsumers.get(issue.workspace_path)
  → unified-websocket.ts:createWorkspaceConsumer().onActivityStatusChanged()
  → socket.send(JSON.stringify({ type: "activity_status_changed", ... }))
  → useWorkspaceRealtime.ts:ws.onmessage
  → applyActivityStatusChange() → queryClient.setQueryData()
  → React re-render → groupByActivityStatus() 重算分组
```

### 逐环节验证

| 环节 | 代码位置 | 状态 |
|------|----------|------|
| 状态变化检测 | `collaboration.ts:601-615` | ✅ 逻辑正确 |
| workspace consumer 注册 | `unified-websocket.ts:132-135` | ✅ 调用 `decodeWorkspaceId` |
| workspace consumer 注销 | `unified-websocket.ts:79-81` | ✅ 调用 `decodeWorkspaceId` |
| WebSocket 消息发送 | `unified-websocket.ts:199-209` | ✅ 正确序列化 |
| 前端消息接收 | `useWorkspaceRealtime.ts:59-66` | ✅ 正确解析 |
| 缓存更新 | `useWorkspaceRealtime.ts:14-29` | ✅ queryKey 匹配 |
| Board 重渲染 | `IssueBoard.tsx:33` | ✅ `groupByActivityStatus` 响应缓存变化 |
| Vite proxy | `vite.config.ts:58-65` | ✅ `/workspace-events` 已配置 |

### 根因 1（高置信度）：WebSocket 静默失败，零可观测性

`useWorkspaceRealtime` hook 的 WebSocket 连接在失败时**完全没有反馈机制**：

- 无 `console.log` / `console.warn`（仅消息解析失败时有 warn）
- 无连接状态暴露给 UI
- 无错误计数器或诊断信息
- `onerror` 仅调用 `ws.close()`，不记录任何信息

**后果**：如果 WebSocket 连接因任何原因失败（Vite proxy 未生效、后端未重启、网络问题），Board 页面**完全静默地停止刷新**，用户无法区分"功能正常但没有状态变化"和"WebSocket 已断开"。

**验证方法**：在浏览器 DevTools Network 面板检查 `/workspace-events` 连接状态。如果无 WebSocket 连接或连接状态非 `101 Switching Protocols`，则确认此根因。

**补充：`send()` 静默吞错**（架构师-2 审视发现）

`unified-websocket.ts:235-241` 的 `send()` 函数在 `socket.send()` 失败时仅 `console.warn` 后静默吞掉错误，不触发 cleanup 或 consumer 注销。socket 进入 broken state 后、`onClose` 事件到达前，后续事件会持续静默丢失。这是根因 1 的独立补充——即使 WebSocket 连接建立成功，socket 损坏后也会静默丢失事件。

### 根因 2（中置信度）：auto-advance 后新阶段无 workspace 通知

`auto-advance.ts:executeAutoAdvance()` (line 198-205):

```typescript
private async executeAutoAdvance(stage: Stage, suggestion: StageTransitionSuggestion): Promise<void> {
    const newStage = await this.deps.advanceStage(stage.id, targetKey);
    await this.deps.recordAuditTrail(stage, newStage, suggestion);
    await this.deps.notifyConsumers(stage.id, "onAutoAdvanced", { ... });
    //                                              ^^^^^^^^ 使用旧 stage.id
}
```

`advanceStage()` 清理旧 stage 的 dispatch states 并创建新 stage，但后续 `notifyConsumers` 使用**旧 stage.id**。`notifyConsumers` 内部 (line 601-615)：

1. `mustGetStage(oldStageId)` → 旧 stage（已 `left_at`）
2. `getActivityStatus(oldStageId)` → dispatch states 已清理，`findLatestMessage` 返回旧消息 → "needs_human"
3. 旧状态也是 "needs_human"（因为在 `invokeAgent` 中，`notifyConsumers("onMessageCompleted")` 已将 `lastActivityStatus` 更新为 "needs_human"，且此调用在 `detectStageTransition` → `executeAutoAdvance` 之前执行）→ **无变化，不通知**

新 stage 的 "needs_human" 状态从未通知 workspace consumer。

**影响范围**：每次 auto-advance（design → development → review → merge）都会丢失一次通知。但这是**正确行为**——board 在 agent 完成时已通过 `notifyConsumers("onMessageCompleted")` 收到 "needs_human" 通知，视觉上无感知差异。新 stage 上的 agent 调用仍会触发 "ai_running" 通知。

**修正**：根因 2 的实际影响比初始分析描述的更小。语义上 `notifyConsumers` 应使用新 stage.id 以保持精确，但功能上无用户可感知的差异。优先级降低。

### 根因 3（低置信度）：无兜底轮询 + `refetchOnWindowFocus: false`

`client.ts:10` 设置 `refetchOnWindowFocus: false`。原始设计文档 (F20260626bxqf) 指定 `refetchOnWindowFocus: true` 作为 WebSocket 断连时的兜底。

**更根本的问题**：Board 完全没有兜底轮询机制。当前架构：
- WebSocket 正常 → 实时更新
- WebSocket 断开 → 指数退避重连（最长 30s），期间 Board 完全静默
- `refetchOnWindowFocus: false` → 切标签页也不刷新
- `staleTime: 30s` → 即使有其他触发，30s 内数据被视为新鲜

WebSocket 断连后的 30s 重连窗口内，Board 完全无法获取更新。`refetchOnWindowFocus: true` 只解决"用户切标签页"场景，不解决正常使用中的静默断连。

### 补充：IssueList 页面也缺少实时刷新

`IssueList.tsx` **完全没有调用 `useWorkspaceRealtime`**，仅依赖 React Query 的 `staleTime: 30s` 和 `NewIssueDialog` 的 `invalidateQueries`。List 视图永远不会自动反映 `activity_status` 变化。`useWorkspaceRealtime` 应同时在 `IssueBoard.tsx` 和 `IssueList.tsx` 中使用。

## 核心业务行为

- **当 WebSocket 连接成功时**，Board/List 应在 0.5-1 秒内反映 activity_status 变化
- **当 WebSocket 连接失败时**，应有明确的 UI 诊断信息（连接状态指示器）+ 自动降级为 10s 轮询
- **当 WebSocket 断连后重连时**，应自动同步最新状态并停止轮询
- **当 auto-advance 发生时**，新阶段的状态应在下次 agent 调用前正确反映
- **当 socket.send() 失败时**，应触发 cleanup 而非静默吞错

## 设计方案

### 改动 1：WebSocket 连接状态可观测性（核心修复）

**文件**：`src/web/hooks/useWorkspaceRealtime.ts`

新增连接状态暴露：

```typescript
type WsStatus = "connecting" | "connected" | "disconnected" | "error";

export function useWorkspaceRealtime(workspaceId: string | null): WsStatus {
  // 返回当前连接状态
  // connecting: WebSocket 已创建但 onopen 未触发
  // connected: onopen 已触发
  // disconnected: onclose 已触发，等待重连
  // error: 连接失败
}
```

同时在关键路径添加日志：

- `onopen`：`console.log("[WorkspaceWebSocket] connected", workspaceId)`
- `onclose`：`console.warn("[WorkspaceWebSocket] disconnected, reconnecting in Xms")`
- `onerror`：`console.error("[WorkspaceWebSocket] error")`
- 消息接收：`console.debug("[WorkspaceWebSocket] received", msg.type)`

### 改动 2：Board 页面连接状态指示器

**文件**：`src/web/pages/IssueBoard.tsx`

在 Board 页面顶部显示连接状态（仅非 connected 时显示）：

```
[⚠ WebSocket disconnected — reconnecting...] [Refresh]
```

- `connecting`：显示 "Connecting..." (灰色)
- `disconnected`：显示 "Disconnected — reconnecting..." (黄色) + 手动刷新按钮
- `error`：显示 "Connection error" (红色) + 手动刷新按钮
- `connected`：不显示

手动刷新按钮调用 `queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) })`。

### 改动 3：auto-advance 后通知新阶段 workspace consumer

**文件**：`src/app/issue-collaboration/auto-advance.ts`

`executeAutoAdvance` 中，在 `advanceStage` 之后、`notifyConsumers` 之前，额外通知 workspace consumer：

```typescript
private async executeAutoAdvance(stage: Stage, suggestion: StageTransitionSuggestion): Promise<void> {
    const newStage = await this.deps.advanceStage(stage.id, targetKey);
    await this.deps.recordAuditTrail(stage, newStage, suggestion);
    // 新增：通知 workspace consumer 新阶段的状态
    // advanceStage 清理了旧 dispatch states，新阶段状态为 "needs_human"
    // 但需要通知 board 更新 current_stage 信息
    await this.deps.notifyConsumers(newStage.id, "onAutoAdvanced", { ... });
    //                            ^^^^^^^^^ 使用新 stage.id
}
```

注意：这需要确认 `notifyConsumers(newStageId)` 在新 stage 无 issue consumers 时不会出错。当前实现中 `issueConsumers.get(newStage.issue_id)` 仍可正确找到 consumers（因为 issue 没变，只是 stage 变了）。

### 改动 4：恢复 `refetchOnWindowFocus` 作为安全网

**文件**：`src/web/queries/client.ts`

将 `refetchOnWindowFocus` 从 `false` 改回 `true`，或仅对 board 相关 query 启用。

权衡：`refetchOnWindowFocus: true` 会导致每次标签页切换都触发 refetch（30s staleTime 后）。但这是 WebSocket 断连时的唯一自动恢复机制。

建议方案：保持全局 `false`，在 board 的 `useQuery` 中单独覆盖：

```typescript
const { data: issues = [] } = useQuery({
  queryKey: queryKeys.workspaces.issues(workspaceId ?? ""),
  queryFn: () => api(...),
  enabled: !!workspaceId,
  refetchOnWindowFocus: true,  // board 特有：WebSocket 断连兜底
});
```

### 改动 5：WebSocket 断连时启用轮询降级（架构师-2 建议）

**文件**：`src/web/pages/IssueBoard.tsx`

当 WebSocket 连接状态非 `connected` 时，启用 `refetchInterval` 作为降级轮询：

```typescript
const wsStatus = useWorkspaceRealtime(workspaceId ?? null);

const { data: issues = [] } = useQuery({
  queryKey: queryKeys.workspaces.issues(workspaceId ?? ""),
  queryFn: () => api(...),
  enabled: !!workspaceId,
  refetchOnWindowFocus: true,
  refetchInterval: wsStatus !== "connected" ? 10_000 : false,  // 断连时 10s 轮询
});
```

WebSocket 恢复 `connected` 后，`refetchInterval` 自动变为 `false`，轮询停止。这比单纯的 `refetchOnWindowFocus` 更可靠——覆盖了正常使用中的静默断连场景。

### 改动 6：IssueList 页面也接入实时刷新

**文件**：`src/web/pages/IssueList.tsx`

与 IssueBoard 相同，调用 `useWorkspaceRealtime(workspaceId ?? null)` 并使用相同的 `refetchInterval` 降级策略。

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/web/hooks/useWorkspaceRealtime.ts` | 修改 | 返回连接状态 + 添加日志 + send() 错误处理 |
| `src/web/pages/IssueBoard.tsx` | 修改 | 连接状态指示器 + refetchInterval 降级轮询 |
| `src/web/pages/IssueList.tsx` | 修改 | 接入 `useWorkspaceRealtime` + refetchInterval 降级 |
| `src/app/issue-collaboration/auto-advance.ts` | 修改 | `executeAutoAdvance` 使用新 stage.id 通知（低优先级） |
| `src/infra/http/unified-websocket.ts` | 修改 | `send()` 失败时触发 cleanup 而非静默吞错 |

## 设计取舍记录

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| 返回 WsStatus vs 仅 console.log | UI 可感知 + 可诊断 | 多一个返回值 | 选择返回状态，诊断价值高 |
| Board 连接指示器 vs 静默重连 | 用户可感知问题 | UI 多一个元素 | 选择指示器，"反反复复好几天"说明静默失败不可接受 |
| auto-advance 新 stage.id vs 旧 stage.id | 语义精确 | 功能上无用户感知差异 | 选择新 stage.id，低优先级 |
| refetchInterval 降级 vs 仅 refetchOnWindowFocus | 覆盖静默断连场景 | WebSocket 恢复前有短暂轮询开销 | 选择 refetchInterval，可靠性优先 |
| send() 失败触发 cleanup vs 静默吞错 | 及时释放 broken socket 资源 | 可能触发不必要的重连 | 选择触发 cleanup，broken socket 不应继续使用 |
| IssueList 接入 vs 仅 Board | 两个视图都实时更新 | 多一个文件改动 | 选择都接入，hook 已复用 |

## 验证计划

1. **WebSocket 连接验证**：打开 Board 页面，DevTools Network 面板确认 `/workspace-events` 连接状态为 `101`
2. **状态变化验证**：在 Conversation 页面发送消息，观察 Board 卡片在 1s 内从 "Needs You" 移到 "AI Running"
3. **断连恢复验证**：手动断开 WebSocket（DevTools → Network → Close），确认：
   - 连接状态指示器出现
   - 自动重连后指示器消失
   - 重连后 Board 数据同步最新状态
4. **auto-advance 验证**：触发阶段切换（如 design → development），确认 Board 在切换后正确反映新阶段状态
5. **标签页切换验证**：切换标签页再切回，确认 Board 自动刷新（refetchOnWindowFocus）
6. **轮询降级验证**：断开 WebSocket，等待 10s，确认 Board 通过轮询获取最新数据
7. **IssueList 验证**：打开 List 页面，触发状态变化，确认 List 自动更新

## 交叉审视记录

### 第一轮：架构师-1 初始分析

- 根因 1：WebSocket 静默失败，零可观测性（高置信度）
- 根因 2：auto-advance 旧 stage.id 导致无通知（中置信度）
- 根因 3：refetchOnWindowFocus: false 移除安全网（低置信度）

### 第二轮：架构师-2 交叉审视

- 根因 1：完全认同。补充 `send()` 静默吞错问题
- 根因 2：置信度需修正。auto-advance 路径大概率会触发通知（"ai_running" → "needs_human"），因为 `invokeAgent` 中 `notifyConsumers("onMessageCompleted")` 在 `detectStageTransition` 之前执行
- 根因 3：认同，但补充"无兜底轮询"作为更根本的问题
- 建议补充：refetchInterval 降级机制、IssueList 也需接入

### 第三轮：架构师-1 回应

- 根因 2：重新验证后维持原判断。`notifyConsumers("onMessageCompleted")` 确实在 `detectStageTransition` 之前执行，将 `lastActivityStatus` 更新为 "needs_human"。后续 `executeAutoAdvance` 的 `notifyConsumers(oldStageId)` 返回相同状态，无变化不通知。但这是正确行为——board 已在 agent 完成时收到通知
- 认同：send() 静默吞错、兜底轮询、IssueList 接入
- 最终方案：6 个改动，根因 2 优先级降低
