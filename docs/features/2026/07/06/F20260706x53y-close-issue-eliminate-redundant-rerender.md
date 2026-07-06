---
id: F20260706x53y
title: close-issue-eliminate-redundant-rerender
from_ids: []
tags: [bugfix, frontend, websocket, react-query]
modules: [web]
---

# F20260706x53y Close Issue 消除冗余重渲染

## 状态

- [x] design
- [x] development
- [ ] review
- [ ] merge

## 问题描述

Close Issue 操作会触发一次明显的"页面刷新"感。此前已通过 PR #531（异步清理 + 乐观更新）和 PR #551（WebSocket onOpen 去除 invalidateQueries）修复了两个根因，但问题仍然存在。

## 用户意图锚

> 「close issue **还是**会触发一次页面刷新，这个问题**修复过了**为什么**还没修复好**？！」

| 修饰语 | 原文 | 含义 |
|--------|------|------|
| 时序 | 「还是」 | 问题持续存在，此前修复未解决 |
| 数量 | 「修复过了」 | 至少一次修复尝试已发生 |
| 条件 | 「为什么还没修复好」 | 预期已修复但实际未修复 |

**意图**：此前的修复（PR #531, #551）未彻底解决 close issue 的页面刷新问题，需要找到残留根因并修复。

## 根因分析

### 已修复的根因（PR #531, #551）

| 根因 | 修复方式 | PR |
|------|---------|-----|
| `cleanupResources` 同步阻塞 API 响应 2-3s | 拆分为同步 DB 事务 + 异步清理 | #531 |
| `onSuccess` 调用 `invalidateQueries` 导致全量 refetch | 替换为 `onMutate` 乐观更新 + `onSuccess` 的 `setQueryData` | #531 |
| WebSocket `onOpen` 调用 `invalidateQueries` | 替换为 `refetchStaleQueries`（30s 阈值） | #551 |

### 当前残留根因：4 次 `setQueryData` 级联触发

完整数据流追踪（后端 → WebSocket → 前端）：

```
时间线 ─────────────────────────────────────────────────────→

[T0] onMutate          → setQueryData(issues.detail)    ← 仅设 closed_at（不设 activity_status）
                       → setQueryData(workspaces.issues) ← 设 closed_at + activity_status: "completed"

[T1] API /close 返回    → setQueryData(issues.detail)    ← 服务端完整数据覆盖

[T2] WS activity_status → setQueryData(issues.detail)    ← 冗余！workspaces.issues 已在 T0 设置
     _changed           → setQueryData(workspaces.issues) ← 冗余！同上

[T3] WS cleanup_completed → setQueryData(issues.detail) ← 设置 close_summary（新信息）
```

**关键冗余**：T2 的 WebSocket `activity_status_changed` 事件与 T0 的乐观更新重复。`onMutate` 对 workspace list cache 已设置 `activity_status: "completed"`，后端仍然同步发出 `activity_status_changed` 事件。对 detail cache 虽然 T0 未设 `activity_status`，但 T1 的 `onSuccess` 已用服务端数据覆盖，T2 仍然是冗余的。

**每次 `setQueryData` 触发独立的 React 重渲染周期**，加上组件树重构（`StageActionBar` 卸载、`ChatInput` 从输入框切换为只读消息），用户感知为"页面刷新"。

### 后端事件发出逻辑

`closeIssue()` 方法（`collaboration.ts:177-189`）：

```typescript
async closeIssue(issueId: string): Promise<CloseIssueResultDto> {
  // Phase 1: 同步
  const issue = await this.deps.issuePort.closeIssue(issueId);  // DB 事务
  this.notifyWorkspaceClose(issueId, issue.workspace_path);      // 发出 activity_status_changed
  // Phase 2: 异步
  this.cleanupResourcesAsync(issueId, issue.context, issue.workspace_path);
  return { issue, status: "pending" };
}
```

`notifyWorkspaceClose` 发出 `activity_status_changed` 事件到 workspace-events WebSocket，与前端乐观更新完全重复。

### 前端处理逻辑

**mutation**（`issue.mutations.ts:15-62`）：
- `onMutate`：乐观设置 `closed_at`（detail cache 仅设 `closed_at`；workspace list cache 设 `closed_at` + `activity_status: "completed"`）
- `onSuccess`：`setQueryData` 设置服务端返回的完整 issue 数据
- **无 `invalidateQueries`** ✅

**EventBatcher**（`useWebSocket.ts:89-376`）：
- `applyActivityStatus()`：`setQueryData` 更新 `activity_status`（冗余）
- `applyCleanupResults()`：`setQueryData` 更新 `close_summary`（新信息，必要）
- `flush()` 中的 `invalidateQueries` 仅用于 `stage_transition_suggested` 和 `stage_changed`，与 close issue 无关 ✅

## [design-time] 设计方案

### 核心业务行为

1. **当用户确认关闭 Issue 时**，前端应通过乐观更新立即反映 `closed_at` 和 `activity_status` 变化，不等待服务端响应
2. **当服务端响应返回时**，前端应使用 `setQueryData` 更新完整 issue 数据，但不应触发额外的 `invalidateQueries`
3. **当 WebSocket `activity_status_changed` 事件到达时**，如果该 issue 已在本地缓存中标记为 `closed_at`，应跳过更新以避免冗余重渲染
4. **当 WebSocket `cleanup_completed` 事件到达时**，应正常更新 `close_summary`（这是新信息）

### 方案：前端过滤冗余 WebSocket 事件

**修改点 1**：`EventBatcher.applyActivityStatus()` 增加 closed_at 检查

在 `useWebSocket.ts` 的 `applyActivityStatus()` 方法中，更新前检查缓存中的 `closed_at`：

```typescript
private applyActivityStatus(): void {
  for (const [issueId, activityStatus] of this.pendingActivityStatus) {
    // 如果 issue 已关闭（乐观更新已设置 closed_at），跳过冗余的 activity_status 更新
    const currentDetail = this.queryClient.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
    if (currentDetail?.closed_at) continue;

    this.queryClient.setQueryData(/* ... */);
    this.queryClient.setQueriesData(/* ... */);
  }
  this.pendingActivityStatus.clear();
}
```

**修改点 2**：`useWorkspaceRealtime.ts` 的 `applyActivityStatusChange()` 增加同样检查

```typescript
function applyActivityStatusChange(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string, issueId: string, activityStatus: ActivityStatus,
): void {
  // 如果 issue 已关闭（乐观更新已设置 closed_at），跳过冗余的 activity_status 更新
  const currentDetail = queryClient.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
  if (currentDetail?.closed_at) return;

  queryClient.setQueryData(/* ... */);
  queryClient.setQueriesData(/* ... */);
}
```

### 为什么选择"前端过滤"而非"后端不发事件"

1. **后端 `notifyWorkspaceClose` 的 `activity_status_changed` 事件对非当前 issue 的页面有价值**：workspace board/list 页面需要知道某个 issue 状态变化
2. **前端过滤更精确**：只有当前页面已持有该 issue 的乐观更新时才跳过，不影响其他页面
3. **改动范围小**：仅修改两处 `applyActivityStatus` 逻辑，不影响后端

### 不兼容更新

无。纯前端行为优化，不改变 API 或 WebSocket 协议。

## 架构师-2 对抗审视

### 审查结论：方案可行，有两个补充点需记录

#### 1. 数据流验证：确认 4 次 setQueryData 级联

独立验证代码后确认时间线准确：

| 时间 | 来源 | setQueryData 目标 | 数据 |
|------|------|-------------------|------|
| T0 | `onMutate` | `issues.detail` | `closed_at`（无 `activity_status`）|
| T0 | `onMutate` | `workspaces.issues` | `closed_at` + `activity_status: "completed"` |
| T1 | `onSuccess` | `issues.detail` | 服务端完整数据覆盖 |
| T2 | WS `activity_status_changed` | `issues.detail` + `workspaces.issues` | `activity_status`（冗余）|
| T3 | WS `cleanup_completed` | `issues.detail` | `close_summary`（新信息）|

**验证**：`flush()` 中处理顺序为 `applyActivityStatus()` → `applyCleanupResults()`（line 332-333），如果 T2 和 T3 在同一 16ms 批处理窗口内到达，它们会在同一次 flush 中处理。过滤 T2 后，T3 仍正常执行。

#### 2. `closed_at` 检查时机可靠性：确认可靠

- `onMutate` 在 mutation 发起前同步执行（`await qc.cancelQueries` + `setQueryData`），设置 `closed_at`
- API 响应最快 ~50ms（同步 DB 事务），WebSocket `activity_status_changed` 在 API 响应后才发出
- 因此 `closed_at` 一定先于 WS 事件到达缓存，过滤条件始终满足

**边界场景验证**：
- Issue 重开：重开会设 `closed_at = null`，过滤条件失效，WS 更新正常通过 ✅
- 从其他页面关闭：详情缓存无 `closed_at`，WS 更新正常通过（不影响 board/list） ✅
- 详情缓存不存在：`applyActivityStatus` 的 updater 函数 `(old) => old ? ... : old` 本身就是 no-op ✅

#### 3. 补充点 A：`onMutate` 与 `onSuccess` 的 activity_status 不一致

发现一个语义不一致但**不影响功能**的问题：

- `onMutate` 对 detail cache 只设 `closed_at`，**不设** `activity_status`
- `onMutate` 对 workspace list cache 设 `closed_at` + `activity_status: "completed"`
- `onSuccess` 用服务端数据覆盖 detail cache

如果服务端 `closeIssue()` 返回的 issue 对象不含 `activity_status: "completed"`（DB 中只更新了 `closed_at`），则 detail cache 的 `activity_status` 可能不是 `"completed"`。

**影响**：无。UI 判断 issue 是否关闭用的是 `closed_at`（`StageActionBar` line 53, `IssueConversation` line 256），不检查 `activity_status`。且 workspace list cache 维持了正确的 `activity_status`。

**建议**：不在本 PR 修复，记录为已知语义缝隙。如后续有 UI 依赖 detail cache 的 `activity_status`，需在 `onMutate` 中补充设置。

#### 4. 补充点 B：`StageActionBar` 的 cleanup toast 订阅时序

`StageActionBar`（line 29-43）通过 `getQueryCache().subscribe()` 监听 `close_summary` 变化弹 toast。组件在 `onMutate` 设置 `closed_at` 后立即卸载（line 53），但 `useEffect` 的 cleanup 函数在卸载时才取消订阅。

**时序**：
- T0: `onMutate` → `closed_at` 设置 → React 重渲染 → StageActionBar 卸载 → `useEffect` cleanup 执行 → 订阅取消
- T3: WS `cleanup_completed` → `close_summary` 更新 → 无订阅者 → toast 不弹

**影响**：cleanup 完成的 toast 可能丢失。但这不是本方案引入的问题——在当前代码中已经存在。`onSuccess` 的 "Issue 已关闭" toast 能正常弹出（在组件卸载前触发），用户仍有反馈。

**建议**：不在本 PR 修复。如需保证 cleanup toast，应将订阅移至 `IssueConversation` 页面级组件。

#### 5. 方案完整性评估

| 检查项 | 结论 |
|--------|------|
| 前端过滤策略是否遗漏边界场景？ | 无遗漏。重开、跨页面关闭、缓存不存在均已覆盖 |
| 是否有其他途径导致"刷新感"？ | 无。`invalidateQueries` 仅在 `stage_transition_suggested` 和 `stage_changed` 中使用，close issue 不触发这两类事件 |
| 两个修改点是否充分？ | 充分。`applyActivityStatus`（issue-level WS）和 `applyActivityStatusChange`（workspace-level WS）是唯二的 activity_status 写入路径 |
| 是否影响其他功能？ | 不影响。workspace board/list 页面的 activity_status 更新不受影响（非当前 issue 的 `closed_at` 为 null） |

### 审查结论

**方案通过**。数据流分析准确，过滤策略正确，修改点充分。两个补充点（activity_status 语义缝隙、cleanup toast 时序）均为已知问题，不在本 PR 范围内。

### 严格复核修正记录

架构师-2 严格复核发现 4 个文档问题，已全部修正：
1. T0 数据流描述：detail cache 仅设 `closed_at`，不设 `activity_status`（已拆分描述）
2. 用户意图锚章节：已补充
3. 验收标准与已知问题矛盾：cleanup toast 标注为已知限制（已修正）
4. 前端处理逻辑段落：明确区分两个缓存的不同行为（已修正）

## 验收标准

- [ ] Close Issue 后，页面无明显"闪烁"或"刷新"感
- [ ] Close Issue 后，`StageActionBar` 平滑卸载
- [ ] Close Issue 后，`ChatInput` 平滑切换为只读消息
- [ ] Close Issue 后，`cleanup_completed` 事件仍正常更新 `close_summary`（cleanup toast 弹出为已知限制，见补充点 B）
- [ ] Workspace board/list 页面的 `activity_status` 更新不受影响（非当前 issue 的更新照常生效）
- [ ] 现有 `CloseIssueDialog` 测试通过
