---
id: F2026062309
title: issue-close-mechanism
from_ids: []
tags: [issue, lifecycle, close]
modules: [issue, collaboration, web, im]
doc_kind: spec
change_type: feature
---

# F2026062309 [core] 新增 Issue 关闭机制，支持任意阶段终止 Issue 生命周期

## 背景

Issue 的生命周期完全依赖 Stage 链推进，但没有机制在用户需要时关闭 Issue：

- `Issue.closed_at` 存在但永远为 null（没有任何代码写入它）
- `IssueRepository` 没有 `update` 方法，无法修改 Issue 状态
- Stage 推进靠 `available_transitions`，最后一个 stage 没有出边，无法"完成"Issue
- 单阶段 SOP（general-assistant、evolution）没有 transitions，Issue 永远停在 `in_progress`
- Issue 的 status 完全从 current_stage 推导，缺少 Issue 级别的状态语义

## 目标

提供一个简单的 `closeIssue` 操作，让用户在任意阶段主动终止 Issue。Issue 生命周期由 `closed_at` 一个字段驱动：

```
active (closed_at = null)  ──用户关闭──→  closed (closed_at ≠ null)
```

## 非目标

- 不新增数据库列（复用已有 `closed_at`）
- 不引入 `completed`/`archived` 等额外状态（归档由前端过滤实现）
- 不改变 Stage 推进机制（`advanceStage` 不变）
- 不自动关闭 Issue（始终由用户主动触发）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | When 用户调用 `POST /api/issues/:issueId/close` | Issue 的 `closed_at` 被设置为当前时间，当前活跃 stage 的 `left_at` 同步设置 | N/A |
| B2 | When 对已关闭的 Issue 再次调用 close | 幂等返回，不报错 | N/A |
| B3 | When 服务重启，存在已关闭 Issue 的 stage 有未处理的 call signal | startup recovery 跳过这些 stage，不重新入队 | N/A |
| B4 | When IM lobby 展示 issue 列表 | 已关闭 Issue 显示 `closed` 状态（而非之前的 `archived`） | N/A |
| B5 | When 前端 issue list 按状态分组 | 分为 `active` 和 `closed` 两列（替代之前的 `in_progress`/`completed`） | N/A |

## 设计

### 1. Issue 状态模型

Issue 状态由 `closed_at` 派生，不新增字段：

| `closed_at` | 状态 | 含义 |
|-------------|------|------|
| `null` | `active` | 进行中 |
| 非 null | `closed` | 已终结（用户主动关闭） |

### 2. closeIssue 操作

**原子性**：`updateClosedAt` 和 `stage.update(left_at)` 在同一个 SQLite 事务内执行。

**幂等性**：已关闭的 Issue 直接返回，不报错。

**副作用**：关闭时同步标记当前活跃 stage 为 `left`，确保 StageQueue 停止处理。

### 3. Startup Recovery

遍历所有有待处理 call signal 的 stage 时，先检查所属 Issue 是否已关闭：
- 查 stage → 查 issue → `issue.closed_at` 非 null → 跳过

### 4. 前端状态分组

`groupByStatus` 从 `closed_at` 派生 Issue 级别 status（替代从 `current_stage.status` 推导）。

## 生效路径

- `src/domain/issue/_internal/repository.ts` — `IssueRepository` 加 `updateClosedAt`，`StageRepository` 加 `findActiveByIssue`
- `src/domain/issue/_internal/adapter.ts` — `IssueAdapter` 加 `closeIssue`（事务内执行）
- `src/domain/issue/_internal/initor.ts` — 传 `stageRepo` 给 `IssueAdapter`
- `src/domain/issue/port.ts` — `IssuePort` 加 `closeIssue`
- `src/app/issue-collaboration/port.ts` — `CollaborationInput` 加 `closeIssue`
- `src/app/issue-collaboration/collaboration.ts` — `IssueCollaboration` 加 `closeIssue`
- `src/app/issue-collaboration/initor.ts` — 传 `issuePort`、`stagePort` 给 `startupRecovery`
- `src/app/issue-collaboration/startup-recovery.ts` — 跳过已关闭 Issue 的 stage
- `src/infra/http/routes/issue.route.ts` — 新增 `POST /api/issues/:issueId/close`
- `src/api-contracts/endpoints.ts` — 新增 close endpoint 类型
- `src/web/lib/issue-utils.ts` — 从 `closed_at` 派生 status，`active`/`closed` 两列分组
- `src/web/mutations/issue.mutations.ts` — 新增 `useCloseIssue` hook
- `src/domain/im/_internal/command-executor.ts` — status 标签从 `archived` 改为 `closed`

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/domain/issue/_internal/repository.ts` | 修改 | `IssueRepository` 加 `updateClosedAt`；`StageRepository` 加 `findActiveByIssue` |
| `src/domain/issue/_internal/adapter.ts` | 修改 | `IssueAdapter` 构造器加 `stageRepo`；新增 `closeIssue` 方法 |
| `src/domain/issue/_internal/initor.ts` | 修改 | 传 `stageRepo` 给 `IssueAdapter` |
| `src/domain/issue/port.ts` | 修改 | `IssuePort` 加 `closeIssue` 接口 |
| `src/app/issue-collaboration/port.ts` | 修改 | `CollaborationInput` 加 `closeIssue` |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | `IssueCollaboration` 加 `closeIssue` |
| `src/app/issue-collaboration/initor.ts` | 修改 | 传 `issuePort`、`stagePort` 给 `startupRecovery` |
| `src/app/issue-collaboration/startup-recovery.ts` | 修改 | 恢复时跳过 closed issue |
| `src/infra/http/routes/issue.route.ts` | 修改 | 新增 `POST /api/issues/:issueId/close` |
| `src/api-contracts/endpoints.ts` | 修改 | 新增 close endpoint 类型定义 |
| `src/web/lib/issue-utils.ts` | 修改 | 从 `closed_at` 派生 status，改为 `active`/`closed` 两列 |
| `src/web/mutations/issue.mutations.ts` | 修改 | 新增 `useCloseIssue` hook |
| `src/domain/im/_internal/command-executor.ts` | 修改 | `archived` → `closed` |

## 验证

- [x] TypeScript 编译通过
- [x] ESLint 通过
- [x] Vite 构建通过
- [x] 无 task_anchor 等无关字段混入
- [x] closeIssue 在事务内执行（updateClosedAt + stage.update 原子性）
- [x] startup recovery 跳过已关闭 issue
