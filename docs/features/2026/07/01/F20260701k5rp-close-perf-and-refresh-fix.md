---
id: F20260701k5rp
title: Close Issue 耗时优化与页面刷新修复
tags: [bugfix, performance, frontend, collaboration]
modules: [collaboration, web]
---
# Close Issue 耗时优化与页面刷新修复

**编号**：F20260701k5rp
**状态**：development
**变更类型**：bugfix
**创建**：2026-07-01

## 问题

Close Issue 操作耗时 2-3 秒，期间 UI 无任何反馈；关闭完成后页面出现强制刷新感。

## 根因分析

### 完整数据流追踪

```
用户点击 Close Button (StageActionBar.tsx:70)
  → window.confirm
  → closeIssue.mutate(issue.id) (issue.mutations.ts:18)
  → POST /api/issues/:id/close
    → collaboration.closeIssue() (collaboration.ts:169)
      → issuePort.closeIssue() — SQLite 事务 (<50ms)
      → WebSocket 通知 activity_status_changed (快)
      → cleanupResources() (resource-cleanup.ts:78) ← 阻塞！
        → gh pr close        (~0.5-1s, 网络)
        → git worktree remove (~0.3-0.5s, 本地 I/O)
        → git branch -d       (~0.1s, 本地 I/O)
        → git push origin --delete (~0.5-1s, 网络)
      → updateCloseSummary()
    → API 返回
  → onSuccess: invalidateQueries × 2 → 全量 refetch
  → WebSocket activity_status_changed → setQueryData 乐观更新
  → 组件树重渲染 → 用户感知为"强制刷新"
```

### 根因 1（高置信度）：cleanupResources 同步阻塞 API 响应

`collaboration.ts:197` 中 `await cleanupResources(...)` 在 HTTP 请求处理链路内同步执行。4 个 shell 命令串行执行（`resource-cleanup.ts:94-113`），全部完成后 API 才返回。

**关键判断**：资源清理是 best-effort 后台操作，与"关闭 issue"的业务语义无关。用户关心的是 issue 状态变为 closed，而不是 PR/worktree/branch 有没有被清理。

### 根因 2（高置信度）：invalidateQueries 触发全量 refetch

`issue.mutations.ts:21-22` 中 `onSuccess` 对两个 queryKey 调用 `invalidateQueries`，触发 issue detail 和 workspace issues 的全量 refetch。refetch 导致组件树大面积重渲染。

叠加 WebSocket 的 `activity_status_changed` 乐观更新（`useWorkspaceRealtime.ts:67-68`），形成双重 cache 更新冲突。如果 WebSocket 在 close 期间断连重连，`useWebSocket.ts:347` 的 `onOpen` handler 也会 `invalidateQueries`，形成三次冲突。

## 核心业务行为

- **当用户点击 Close 时**，UI 应在 200ms 内给出关闭成功的视觉反馈
- **当资源清理执行时**，不应阻塞 API 响应，清理结果异步可用
- **当关闭完成后**，页面应在原地平滑过渡到只读状态，不应有全量刷新感
- **当资源清理失败时**，用户可通过 toast 或详情面板查看清理结果

## 设计方案

### 改动 1：资源清理从 API 响应链路中剥离

**文件**：`src/app/issue-collaboration/collaboration.ts`

将 `closeIssue()` 方法拆分为两阶段：

**阶段一（同步，API 响应前）**：
- DB 事务：设置 `closed_at`、`left_at`
- WebSocket 通知 workspace consumers
- 返回 `{ issue, cleanup: { pr: { status: "pending" }, worktree: { status: "pending" }, localBranch: { status: "pending" }, remoteBranch: { status: "pending" } } }`

**阶段二（异步，API 响应后）**：
- 执行 `cleanupResources()`
- 将结果写入 `close_summary`（已有逻辑）
- 通过 WebSocket 推送 `cleanup_completed` 事件，携带 cleanup 结果

```typescript
async closeIssue(issueId: string): Promise<{ issue: Issue; cleanup: CleanupResult }> {
  // ... 幂等检查 ...
  const issue = this.deps.issuePort.closeIssue(issueId);
  // ... WebSocket 通知 workspace consumers ...

  // 立即返回 pending 状态
  const pendingCleanup: CleanupResult = {
    pr: { status: "pending" },
    worktree: { status: "pending" },
    localBranch: { status: "pending" },
    remoteBranch: { status: "pending" },
  };

  // 异步执行清理，不阻塞响应
  this.cleanupResourcesAsync(issueId, issue.context, issue.workspace_path);

  return { issue, cleanup: pendingCleanup };
}

private async cleanupResourcesAsync(
  issueId: string,
  context: Record<string, string>,
  workspacePath: string,
): Promise<void> {
  let cleanup: CleanupResult | undefined;
  try {
    cleanup = await cleanupResources(context, workspacePath);
  } catch (err) {
    log.error({ issueId, err }, "cleanupResourcesAsync failed");
    // 即使整体异常，也构造 error 状态通知用户
    cleanup = {
      pr: { status: "failed", error: String(err) },
      worktree: { status: "failed", error: String(err) },
      localBranch: { status: "failed", error: String(err) },
      remoteBranch: { status: "failed", error: String(err) },
    };
  }
  try {
    this.deps.issuePort.updateCloseSummary(issueId, cleanup);
  } catch (err) {
    log.error({ issueId, err }, "closeIssue: updateCloseSummary failed");
  }
  // 无论成功失败都推送结果，确保用户可见
  this.notifyCleanupCompleted(issueId, cleanup);
}
```

### 改动 2：前端乐观更新替代 refetch

**文件**：`src/web/mutations/issue.mutations.ts`

在 `useCloseIssue` 的 `onMutate` 阶段直接设置 cache，取消 `onSuccess` 中的 `invalidateQueries`：

```typescript
export function useCloseIssue(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string): Promise<CloseIssueResultDto> =>
      api("POST /api/issues/:issueId/close", { params: { issueId } }),

    onMutate: async (issueId) => {
      // 取消正在进行的 refetch，避免覆盖乐观更新
      await qc.cancelQueries({ queryKey: queryKeys.issues.detail(issueId) });
      await qc.cancelQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });

      // 保存回滚快照
      const prevDetail = qc.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
      const prevList = qc.getQueryData<IssueDetailDto[]>(queryKeys.workspaces.issues(workspaceId));

      // 乐观更新 issue detail
      if (prevDetail) {
        qc.setQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId), {
          ...prevDetail,
          closed_at: new Date().toISOString(),
        });
      }

      // 乐观更新 workspace issues list
      if (prevList) {
        qc.setQueryData<IssueDetailDto[]>(
          queryKeys.workspaces.issues(workspaceId),
          prevList.map(issue =>
            issue.id === issueId
              ? { ...issue, closed_at: new Date().toISOString(), activity_status: "completed" as const }
              : issue
          ),
        );
      }

      return { prevDetail, prevList };
    },

    onError: (_err, issueId, context) => {
      // 回滚乐观更新
      if (context?.prevDetail) {
        qc.setQueryData(queryKeys.issues.detail(issueId), context.prevDetail);
      }
      if (context?.prevList) {
        qc.setQueryData(queryKeys.workspaces.issues(workspaceId), context.prevList);
      }
    },

    onSuccess: (data, issueId) => {
      // 用服务端返回的真实数据覆盖乐观更新（包含 cleanup 结果）
      qc.setQueryData(queryKeys.issues.detail(issueId), data.issue);
      // 不再 invalidateQueries，避免全量 refetch
    },
  });
}
```

### 改动 3：cleanup 结果通过 issue-level WebSocket 推送

**文件**：`src/infra/http/unified-websocket.ts`

走 **issue-level WebSocket**（`/issue-events`），在 `IssueRealtimeMessage.event` union 中新增 `cleanup_completed` 变体。理由：用户关闭 issue 时大概率在 issue detail 页（issue-level WS 连着），且此消息语义上属于 issue 生命周期事件。

```typescript
// IssueRealtimeMessage.event 新增变体
interface CleanupCompletedEvent {
  type: "cleanup_completed";
  issue_id: string;
  cleanup: CleanupResult;
}
```

**已知限制**：如果用户从 board 视图关闭 issue 后快速导航离开，issue-level WS 会断开，`cleanup_completed` toast 不会弹出。但用户此时已不在 detail 页，不影响核心体验；下次进入 detail 页时 `close_summary` 会通过 HTTP refetch 获取。

前端 `useWebSocket.ts` 的 EventBatcher 处理此事件，更新 issue detail cache 中的 `close_summary` 字段。

### 改动 4：Toast 显示 cleanup 结果

**文件**：`src/web/components/StageActionBar.tsx`

当前 `handleClose` 的 `onSuccess` 中已有 `showToast(formatCleanupResult(data.cleanup))`。由于改动 1 返回 pending 状态，toast 需要调整：

- API 返回时：显示 "Issue 已关闭"（不显示 cleanup 结果，因为是 pending）
- WebSocket 收到 `cleanup_completed` 时：遍历 cleanup 各项，若存在 `failed` 项则弹 warning toast 显示失败详情；若全部 `success`/`skipped` 则弹 success toast

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/app/issue-collaboration/collaboration.ts` | 修改 | closeIssue 拆分同步/异步两阶段 |
| `src/app/issue-collaboration/resource-cleanup.ts` | 不变 | 清理逻辑本身无需修改 |
| `src/web/mutations/issue.mutations.ts` | 修改 | 乐观更新替代 invalidateQueries |
| `src/infra/http/unified-websocket.ts` | 修改 | 新增 cleanup_completed 消息类型 |
| `src/web/hooks/useWebSocket.ts` | 修改 | 处理 cleanup_completed 事件 |
| `src/web/components/StageActionBar.tsx` | 修改 | toast 逻辑适配两阶段 |

## 设计取舍记录

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| cleanup 异步 vs 同步 | API 响应快，UI 即时反馈 | cleanup 结果延迟可用 | 选择异步，用户体验优先 |
| 乐观更新 vs invalidateQueries | 无全量 refetch，平滑过渡 | 需处理回滚逻辑 | 选择乐观更新，消除强制刷新感 |
| pending 状态 vs 不返回 cleanup | API 语义明确 | 多一个中间状态 | 选择 pending，前端可显示"清理中" |
| WebSocket 推送 cleanup 结果 vs 轮询 | 实时性强 | 需新增消息类型 | 选择 WebSocket，已有基础设施 |
| cleanup_completed 独立事件 vs 复用 activity_status_changed | 语义清晰 | 多一个事件类型 | 选择独立事件，避免混淆业务状态 |

## 验证计划

1. **响应时间验证**：点击 Close，确认 API 在 200ms 内返回
2. **UI 平滑过渡验证**：确认关闭后页面无全量刷新感，原地变为只读状态
3. **乐观更新回滚验证**：模拟 API 失败，确认 cache 正确回滚
4. **cleanup_completed toast 验证**：确认 WebSocket 收到 `cleanup_completed` 后 toast 正确显示清理结果
5. **cleanup 失败 warning toast 验证**：模拟 git 命令失败，确认 warning toast 弹出失败详情
6. **幂等性验证**：对已关闭的 issue 再次 close，确认直接返回
7. **cleanup 失败不影响关闭验证**：模拟 git 命令失败，确认 issue 关闭状态不受影响
8. **快速导航离开验证**：关闭 issue 后立即导航离开 detail 页，确认无报错（toast 不会弹出，属已知限制）
9. **无资源 issue 关闭验证**：关闭无 PR/worktree/branch 的 issue，确认 pending → skipped 状态转换正确，cleanup toast 显示全部 skipped
10. **PropertiesPanel 验证**：关闭后刷新页面，确认 PropertiesPanel 中 `close_summary` 显示最终 cleanup 结果（非 pending）

## 交叉审视记录

### 第一轮：架构师-1 初始分析

- 根因 1：cleanupResources 同步阻塞 API 响应（高置信度）
- 根因 2：invalidateQueries 触发全量 refetch + WebSocket 冲突（高置信度）
- 方案：4 个改动 — cleanup 异步化 + 乐观更新 + WebSocket 推送 + Toast 适配

### 第二轮：架构师-2 交叉审视

- Finding 1（行为规格）：cleanup 失败路径 catch 块只 log.error 不通知用户 → 修复：catch 块构造 error 状态并调用 notifyCleanupCompleted
- Finding 2（行为规格）：cleanup_completed 路由层级未指定 → 确认走 issue-level WebSocket，记录已知限制（快速导航离开时 toast 不会弹出）
- Finding 3（质量问题）：验证计划缺少 4 个关键场景 → 补充至 10 项

### 第三轮：架构师-1 回应

- Finding 1：完全认同，更新 cleanupResourcesAsync 确保任何路径都推送结果
- Finding 2：认同 issue-level 路由，已知限制可接受
- Finding 3：认同，已补充验证计划
