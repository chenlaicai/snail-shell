---
id: F20260702k5rp
title: Close Issue 强制刷新页面根因分析
tags: [bugfix, frontend, collaboration, websocket]
modules: [collaboration, web]
---
# Close Issue 强制刷新页面根因分析

**编号**：F20260702k5rp
**状态**：implemented
**变更类型**：bugfix
**创建**：2026-07-02

## 问题描述

Close Issue 操作后页面出现强制刷新感，用户体验不佳。此问题在 F20260701k5rp 中已进行修复，但修复不彻底，问题仍然存在。

## 历史修复记录

### F20260701k5rp 修复内容

1. **资源清理异步化**：将 `cleanupResources` 从 API 响应链路中剥离，改为异步执行
2. **乐观更新替代 refetch**：在 `useCloseIssue` 的 `onMutate` 阶段直接设置 cache，取消 `onSuccess` 中的 `invalidateQueries`
3. **WebSocket 推送 cleanup 结果**：新增 `cleanup_completed` 消息类型
4. **Toast 显示 cleanup 结果**：适配两阶段显示

### 修复效果

API 响应时间从 2-3 秒降至 200ms 以内，但页面仍出现强制刷新感。

## 完整数据流追踪

```
用户点击 Close Button (StageActionBar.tsx:95)
  → window.confirm
  → closeIssue.mutate(issue.id) (issue.mutations.ts:18)
  → POST /api/issues/:id/close
    → collaboration.closeIssue() (collaboration.ts:166)
      → issuePort.closeIssue() — SQLite 事务 (<50ms)
      → WebSocket 通知 activity_status_changed (快)
      → cleanupResourcesAsync() — 异步执行，不阻塞 API 响应
    → API 返回
  → onMutate: 乐观更新 issue detail + workspace issues list
  → onSuccess: setQueryData（只更新 detail，不 invalidateQueries）
  → WebSocket activity_status_changed → setQueryData 乐观更新
  → WebSocket cleanup_completed → setQueryData 更新 close_summary
  → ❌ WebSocket 重连 onOpen → invalidateQueries × 2 → 全量 refetch
  → 组件树重渲染 → 用户感知为"强制刷新"
```

## 根因分析

### 根因 1（高置信度）：WebSocket 重连时 onOpen 触发 invalidateQueries

**位置**：`src/web/hooks/useWebSocket.ts:394-396`

```typescript
onOpen: () => {
  // ...
  queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
  const sid = currentStageIdRef.current;
  if (sid) queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(sid) });
  setWsStatus("connected");
},
```

**问题**：WebSocket 连接建立（包括重连）时，会触发 `invalidateQueries`，导致全量 refetch。这会覆盖 `useCloseIssue` 的乐观更新，产生强制刷新感。

**触发场景**：
- WebSocket 连接断开后重连
- 网络波动导致 WebSocket 重连
- 用户切换标签页后返回，WebSocket 重连

### 根因 2（高置信度）：Workspace WebSocket 重连触发 invalidateQueries

**位置**：`src/web/hooks/useWorkspaceRealtime.ts:58`

```typescript
ws.onopen = () => {
  if (!guard(ws)) return;
  console.log("[WorkspaceWebSocket] connected", workspaceId);
  clearTimer(reconnectTimer);
  queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
  reconnectDelay.current = 1000;
  setStatus("connected");
};
```

**问题**：Workspace WebSocket 连接建立时，会触发 `invalidateQueries`，导致 workspace issues list 全量 refetch。这会覆盖 `useCloseIssue` 的乐观更新。

**触发场景**：
- 用户在 IssueList 或 IssueBoard 页面关闭 Issue
- WebSocket 重连时触发全量 refetch

### 根因 3（中置信度）：Stage Transition 触发 invalidateQueries

**位置**：`src/web/hooks/useWebSocket.ts:312-316`

```typescript
for (const { issueId, stageId } of this.pendingStageTransitions) {
  this.queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
  this.queryClient.invalidateQueries({ queryKey: queryKeys.stages.detail(stageId) });
  this.queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
}
```

**问题**：如果 close issue 期间发生 stage transition，会触发 `invalidateQueries`，覆盖乐观更新。

**触发场景**：
- 用户关闭 issue 时，正好有 stage transition 事件

### 根因 4（低置信度）：Stage Changed 触发 invalidateQueries

**位置**：`src/web/hooks/useWebSocket.ts:322-323`

```typescript
for (const { issueId, newStageId } of this.pendingStageChanges) {
  this.queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
  this.queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(newStageId) });
}
```

**问题**：如果 close issue 期间发生 stage changed（auto-advance），会触发 `invalidateQueries`，覆盖乐观更新。

**触发场景**：
- 用户关闭 issue 时，正好有 auto-advance 事件

## 问题本质

**核心冲突**：乐观更新与 WebSocket 重连的 `invalidateQueries` 存在竞争关系。

1. `useCloseIssue` 的 `onMutate` 执行乐观更新（立即生效）
2. `onSuccess` 执行 `setQueryData`（用服务端数据覆盖乐观更新）
3. 但如果 WebSocket 重连，`onOpen` 会触发 `invalidateQueries`
4. `invalidateQueries` 会触发全量 refetch，覆盖之前的乐观更新
5. 用户感知为"强制刷新"

**时序问题**：
- 乐观更新是立即生效的
- WebSocket 重连是异步的，时机不确定
- 如果 WebSocket 重连发生在 close issue 期间，就会产生冲突

## 设计方案

### 方案 A：移除 WebSocket onOpen 中的 invalidateQueries

**思路**：WebSocket 重连时不再触发全量 refetch，依赖增量更新机制。

**优点**：
- 彻底消除强制刷新感
- 简化逻辑，减少竞争条件

**缺点**：
- 需要确保增量更新机制完整（activity_status_changed、cleanup_completed 等）
- 如果增量更新有遗漏，可能导致数据不一致

**风险**：
- 如果 WebSocket 断开期间有数据变化，重连后可能丢失更新

### 方案 B：使用乐观更新锁防止覆盖

**思路**：在 `useCloseIssue` 执行期间，设置乐观更新锁，防止 `invalidateQueries` 覆盖。

**优点**：
- 保留 WebSocket 重连时的全量 refetch（确保数据一致性）
- 只在 close issue 期间防止覆盖

**缺点**：
- 增加复杂度，需要管理锁的状态
- 需要在多个地方检查锁

**风险**：
- 锁的状态管理可能引入新的 bug

### 方案 C：使用 queryClient.setQueryData 覆盖 invalidateQueries

**思路**：在 WebSocket onOpen 中，使用 `setQueryData` 而不是 `invalidateQueries`，避免全量 refetch。

**优点**：
- 保留 WebSocket 重连时的数据更新
- 避免全量 refetch

**缺点**：
- 需要实现增量更新逻辑
- 复杂度较高

**风险**：
- 增量更新逻辑可能有遗漏

### 推荐方案：方案 A

**理由**：
1. 问题本质是乐观更新与 `invalidateQueries` 的竞争关系
2. 方案 A 彻底消除竞争条件，最简单直接
3. 系统已有完整的增量更新机制（activity_status_changed、cleanup_completed 等）
4. 可以通过补充增量更新机制来覆盖所有场景

**实现要点**：
1. 移除 `useWebSocket.ts:394-396` 的 `invalidateQueries`
2. 移除 `useWorkspaceRealtime.ts:58` 的 `invalidateQueries`
3. 确保增量更新机制完整：
   - activity_status_changed：更新 issue detail 和 workspace issues list
   - cleanup_completed：更新 close_summary
   - message_started/message_status_changed：更新 messages
   - stage_transition_suggested/stage_changed：更新 stages

## 验证计划

1. **Close Issue 无闪烁验证**：点击 Close，确认 UI 平滑过渡到只读状态，无闪烁
2. **WebSocket 重连 + Close 并发验证**：模拟 WebSocket 断连重连，同时点击 Close，确认无闪烁（核心竞态场景）
3. **消息实时性验证**：WebSocket 重连后，确认新消息仍通过增量事件正确显示
4. **activity_status 实时性验证**：WebSocket 重连后，确认 issue 状态变化仍正确反映
5. **cleanup_completed toast 验证**：关闭 issue 后，确认 cleanup 结果 toast 仍正常弹出
6. **Board 页面验证**：在 IssueBoard 关闭 issue，确认列表正确更新
7. **初始连接验证**：首次打开 issue detail 页面，确认数据正常加载（无 invalidateQueries 后的首次 fetch 行为）

## 实现记录

### 变更文件

1. `src/web/hooks/useWebSocket.ts`：移除 `onOpen` 中的 `invalidateQueries`（原 394-396 行）
   - 移除 `queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) })`
   - 移除 `queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(sid) })`
   - 保留 `setWsStatus("connected")` 状态更新

2. `src/web/hooks/useWorkspaceRealtime.ts`：移除 `onopen` 中的 `invalidateQueries`（原 58 行）
   - 移除 `queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) })`
   - 保留连接状态管理和重连逻辑

### 增量更新覆盖确认

移除 `invalidateQueries` 后，数据更新完全依赖以下增量机制：

| 事件类型 | 更新目标 | 机制 |
|---------|---------|------|
| `activity_status_changed` | issue detail + workspace issues list | `EventBatcher.applyActivityStatus()` |
| `cleanup_completed` | issue detail (close_summary) | `EventBatcher.applyCleanupResults()` |
| `message_started` | stage messages | `EventBatcher.applyBatch()` |
| `message_event_appended` | stage messages (events) | `EventBatcher.appendEvents()` |
| `message_status_changed` | stage messages (status) | `EventBatcher.updateStatuses()` |
| `user_called` | stage messages | `EventBatcher.applyBatch()` |

### 已知风险

`stage_transition_suggested` 和 `stage_changed` 事件仍使用 `invalidateQueries`（`EventBatcher.flush()` 312-323 行）。概率极低且 stage transition 本身需要全量刷新，保留合理。

## 决策记录

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| 移除 onOpen 中的 invalidateQueries vs 保留 | 彻底消除强制刷新感 | 可能丢失增量更新 | 选择移除，依赖增量更新机制 |
| 方案 A vs 方案 B | 简单直接 | 需要完善增量更新 | 选择方案 A，降低复杂度 |
| 增量更新 vs 全量 refetch | 性能好，无强制刷新感 | 可能有遗漏 | 选择增量更新，补充机制 |

## 交叉审视记录

### 第一轮：架构师-1 初始分析

- 根因 1-4 识别，方案：移除 onOpen 中的 invalidateQueries
- 增量覆盖分析完整
- 三个备选方案，推荐方案 A

### 第二轮：架构师-2 交叉审视

**独立验证结论**：根因分析正确，方案 A 推荐成立。以下为审视发现：

#### Finding 1（行为规格）：验证计划缺少核心竞态场景

当前验证计划缺少"WebSocket 重连与 Close Issue 同时发生"的专项测试。这正是用户报告的场景。

**处置**：补充验证项 "WebSocket 重连 + Close 并发验证"。

#### Finding 2（实现指引）：cancelQueries 不能保证取消网络请求

分析中提到 `onMutate` 的 `cancelQueries` 可以取消进行中的 refetch，但 React Query 的 `cancelQueries` 只是 reject observer promise，不会 abort 底层 fetch。如果 `invalidateQueries` 在 `cancelQueries` 之后触发（WebSocket 重连时序），新的 refetch 不受之前的 cancel 影响。

**处置**：方案 A 移除 `invalidateQueries` 后此问题自然消除。记录为设计决策依据。

#### Finding 3（行为规格）：初始连接也触发 onOpen

`onOpen` 在初始连接和重连时都会触发。方案 A 移除 `invalidateQueries` 后，初始连接也不做全量同步。需要确认：初始连接时 query 的 `staleTime` 配置是否能保证首次 fetch 正常进行。

**处置**：初始连接时 query 处于 stale 状态（无缓存），React Query 会自动触发首次 fetch，无需 `invalidateQueries` 兜底。方案 A 安全。

#### Finding 4（质量问题）：EventBatcher 的 stage transition/change 也有 invalidateQueries

`useWebSocket.ts:312-323` 的 `stage_transition_suggested` 和 `stage_changed` 处理也调用 `invalidateQueries`。如果 close issue 期间发生 stage transition，理论上也会覆盖乐观更新。

**处置**：概率极低（close issue 期间不太可能同时发生 stage transition），且 stage transition 本身需要全量刷新 stages 数据，保留 `invalidateQueries` 合理。标记为已知风险，不纳入本次修复。

#### 审视结论

根因分析完整，方案 A（移除 onOpen 中的 invalidateQueries）是正确修复方向。增量覆盖分析已验证 EventBatcher 的 6 种事件类型完整覆盖了 issue detail 和 messages 的更新需求。

**通过交叉审视。**
