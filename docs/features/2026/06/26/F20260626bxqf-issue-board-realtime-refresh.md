---
id: F20260626bxqf
title: Issue Board 实时刷新
from_ids: [F20260625swf8, F20260625bc8d, F20260625ad94]
tags: [web, realtime, websocket, board]
modules: [collaboration, web]
---
# Issue Board 实时刷新

**编号**：F20260626bxqf
**状态**：development
**变更类型**：feature
**创建**：2026-06-26

## 问题

Issue Board 页面没有实时刷新机制。AI running ↔ needs human 之间的状态变动需要用户手动点击或切换窗口才能看到。

### 根因分析

Issue Board 页面只使用 TanStack Query 的 `useQuery`（`staleTime: 30_000` + `refetchOnWindowFocus: true`），没有建立任何 WebSocket 连接。

现有的 WebSocket 实时通信只在 IssueConversation 页面生效——`useIssueRealtime(issueId, stageId)` 为单个 issue 建立连接。`EventBatcher.applyActivityStatus()` 理论上会更新 `queryKeys.workspaces.issues` 缓存，但这个更新只在 Conversation 页面的 WebSocket 连接活跃时才会触发。用户停留在 Board 页面时，不会收到任何实时推送。

## 设计目标

1. Issue Board 页面的 `ai_running` / `needs_human` / `completed` 状态变更在 0.5-1 秒内反映到 UI
2. 不引入不必要的复杂度，复用现有 WebSocket 基础设施模式
3. 方案可复用到 IssueList 页面

## 核心业务行为

- **当任何 issue 的 activity_status 变化时**，Board 页面应在 0.5-1 秒内更新对应卡片的状态标签和分组位置
- **当 WebSocket 断连时**，客户端自动重连，重连后同步最新状态
- **当 Board 页面离开时**，WebSocket 连接自动关闭，不消耗服务端资源

## 方案对比

| 维度 | 方案 A: Workspace 级 WebSocket | 方案 B: 短轮询 | 方案 C: 多 per-issue WebSocket |
|------|------|------|------|
| 连接数 | 1 | 0 | N（issue 数量） |
| 延迟 | 实时（<100ms） | 固定 1-2s | 实时（<100ms） |
| 服务端改动 | 新增 workspace consumer 机制 | 无 | 无（复用现有） |
| 资源消耗 | 低 | 中（每 1-2s HTTP 请求） | 高（N 个 WebSocket） |
| 可复用性 | IssueList 页面可复用 | 通用 | 通用 |

### 决策：方案 A（Workspace 级 WebSocket）

理由：
1. 单连接，高效——不随 issue 数量增长
2. 事件轻量——只传 `{ issue_id, activity_status }`，不含消息内容
3. 与现有 WebSocket 架构风格一致
4. 用户要求 "误差在 1/2 秒内我也能接受"，WebSocket 推送延迟远低于此

## 详细设计

### Server-side

#### 1. Port 层：新增 Workspace Consumer 接口

`src/app/issue-collaboration/port.ts`：

```typescript
export interface WorkspaceConsumer {
  onActivityStatusChanged(issueId: string, activityStatus: ActivityStatus, previousStatus: ActivityStatus): void;
}

export interface CollaborationInput {
  // ... existing methods
  registerWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void;
  unregisterWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void;
}
```

#### 2. Collaboration 层：Workspace Consumer 管理 + 状态变化检测

`src/app/issue-collaboration/collaboration.ts`：

新增内部状态：

```typescript
private readonly workspaceConsumers = new Map<string, Set<WorkspaceConsumer>>();
private readonly lastActivityStatus = new Map<string, ActivityStatus>();  // issueId → status
```

新增核心方法 `notifyWorkspaceStatusChange`：

```typescript
private notifyWorkspaceStatusChange(issueId: string, newStatus: ActivityStatus): void {
  const prev = this.lastActivityStatus.get(issueId);
  if (prev === newStatus) return;  // 无变化，跳过
  this.lastActivityStatus.set(issueId, newStatus);
  const issue = this.deps.issuePort.findIssue(issueId);
  if (!issue) return;
  const consumers = this.workspaceConsumers.get(issue.workspace_path);
  if (!consumers) return;
  for (const consumer of consumers) {
    consumer.onActivityStatusChanged(issueId, newStatus, prev!);
  }
}
```

**调用点 1：`notifyConsumers` 末尾**（覆盖 message 生命周期事件）

在 `notifyConsumers(stageId, method, ...)` 方法末尾追加：

```
1. 通过 deps.stagePort.findStage(stageId) 获取 stage → stage.issue_id
2. 通过 deps.issuePort.findIssue(stage.issue_id) 获取 issue → issue.closed_at
3. 计算 newStatus = getActivityStatus(stageId, issue.closed_at)
4. 调用 notifyWorkspaceStatusChange(stage.issue_id, newStatus)
```

这覆盖了 `sendMessage`、`invokeAgent`、`interruptMessage`、`detectStageTransition` 等所有消息事件路径。

**调用点 2：`closeIssue` 方法**（覆盖 issue 关闭路径）

`closeIssue` 当前不调用 `notifyConsumers`，需要独立处理：

```typescript
closeIssue(issueId: string): Issue {
  const issue = this.deps.issuePort.closeIssue(issueId);
  this.lastActivityStatus.delete(issueId);  // 清理缓存
  // 通知 workspace consumer：状态变为 completed
  const consumers = this.workspaceConsumers.get(issue.workspace_path);
  if (consumers) {
    for (const consumer of consumers) {
      consumer.onActivityStatusChanged(issueId, "completed", "needs_human");
    }
  }
  return issue;
}
```

**数据访问路径**：`IssueCollaboration` 已有 `deps.issuePort` 和 `deps.stagePort`，无需新增 port 接口。

新增注册/注销方法：

- `registerWorkspaceConsumer(workspaceId, consumer)` — 注册
- `unregisterWorkspaceConsumer(workspaceId, consumer)` — 注销，清理空集合

#### 3. WebSocket Bridge：新增 Workspace Events 端点

新建 `src/infra/http/workspace-websocket.ts`：

- 端点：`/workspace-events?workspace_id=xxx`
- 心跳：30 秒间隔（与现有 `/issue-events` 一致）
- 重连：客户端指数退避（1s → 2s → 4s → ... → 30s max）

事件格式：

```typescript
// 服务端 → 客户端
type WorkspaceWsMessage =
  | { type: "activity_status_changed"; issue_id: string; activity_status: ActivityStatus; previous_status: ActivityStatus }
  | { type: "heartbeat"; ts: number };
```

`previous_status` 字段用途：
- 客户端 defensive check（避免重复状态覆盖）
- 为未来状态转换动画提供信息

#### 4. main.ts 注册

在 `main.ts` 中注册新的 WebSocket 路由，与现有 `createIssueWebSocketBridge` 并列。

### Client-side

#### 5. useWorkspaceRealtime Hook

新建 `src/web/hooks/useWorkspaceRealtime.ts`：

```typescript
export function useWorkspaceRealtime(workspaceId: string | null): void
```

行为：
- 连接 `ws[s]://{host}/workspace-events?workspace_id={workspaceId}`
- **首次连接（onopen）**：执行 `invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) })` 同步最新状态，消除 HTTP 初始加载与 WebSocket 连接之间的竞态窗口
- 收到 `activity_status_changed` 事件时，更新 React Query 缓存：
  - `queryKeys.issues.detail(issueId)` — 更新 `activity_status`
  - `queryKeys.workspaces.issues(workspaceId)` — 更新对应 issue 的 `activity_status`
- 断连时指数退避重连（1s → 2s → ... → 30s）
- 重连成功时 `invalidateQueries` 同步最新状态
- 组件卸载时关闭连接

#### 6. IssueBoard 组件集成

`src/web/pages/IssueBoard.tsx`：

`workspaceId` 来源：路由参数 `const { workspaceId } = useParams()`。

```typescript
useWorkspaceRealtime(workspaceId ?? null);
```

一行代码，无其他 UI 改动。分组逻辑 `groupByActivityStatus` 响应 React Query 缓存变化自动重算。

### 边界情况

| 场景 | 处理方式 |
|------|----------|
| Board 首次加载 | HTTP 获取初始数据；WebSocket onopen 时 invalidateQueries 消除竞态窗口 |
| 新建 issue | HTTP API 创建后 invalidate queries，WebSocket 也会收到后续状态变化 |
| 多个 Board 标签页 | 每个标签页独立 WebSocket 连接，各自收到通知 |
| WebSocket 断连 | 指数退避重连，重连后 invalidateQueries 同步最新状态 |
| Issue 移动到其他 workspace | 不影响——Board 订阅的是当前 workspace，旧 issue 从列表消失是预期行为 |
| Issue 关闭（completed） | `closeIssue` 中独立通知 workspace consumer，Board 自动将卡片移到 Completed 列 |

### 性能考量

- 事件只在 activity_status **实际变化** 时发送（`lastActivityStatus` 去重），不是每个 WebSocket 事件都发
- activity_status 只有 3 个值，状态变化频率低（每个 issue 每次对话周期最多变化 2-3 次）
- 单个事件 payload < 100 bytes，对带宽无压力
- 客户端直接 `setQueryData` 更新缓存，不触发 refetch，React 重渲染最小化

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/app/issue-collaboration/port.ts` | 修改 | 新增 `WorkspaceConsumer` 接口，`CollaborationInput` 新增注册/注销方法 |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | 实现 workspace consumer 管理 + 状态变化检测 + closeIssue 通知 |
| `src/infra/http/workspace-websocket.ts` | 新建 | Workspace WebSocket bridge |
| `src/main.ts` | 修改 | 注册 workspace WebSocket 路由 |
| `src/web/hooks/useWorkspaceRealtime.ts` | 新建 | Board 实时 hook |
| `src/web/pages/IssueBoard.tsx` | 修改 | 调用 `useWorkspaceRealtime` |
| `src/api-contracts/dto.ts` | 修改 | 新增 `WorkspaceWsMessage` 类型 |

## 设计取舍记录

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| Workspace 级 WebSocket vs 短轮询 | 单连接、实时、低延迟 | 需新增服务端基础设施 | 选择 WebSocket，用户要求实时性 |
| closeIssue 独立通知 vs 复用 notifyConsumers | 不侵入现有消息事件链路 | closeIssue 中有重复的通知逻辑 | 选择独立路径，侵入性低 |
| lastActivityStatus 在 closeIssue 中清理 vs 不清理 | 内存干净 | 额外一行代码 | 选择清理，成本可忽略 |
| 事件含 previous_status vs 不含 | 客户端可做 defensive check、支持动画 | 多一个字段 | 选择包含，信息量增加但 payload 仍小 |

## from_ids

- F20260625swf8 — 事件驱动路由 + 三态分组（activity_status 定义、WebSocket 事件附带 activity_status）
- F20260625bc8d — 多 Agent 并发卡死修复（EventBatcher 批处理、性能约束）
- F20260625ad94 — UI 渲染瓶颈修复（activity_status 更新移入 batch、结构共享）
