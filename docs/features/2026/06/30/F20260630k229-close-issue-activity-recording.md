---
id: F20260630k229
title: close-issue-activity-recording
from_ids: [F20260629qrtu]
tags: [close-issue, activity, audit]
modules: [issue-collaboration, domain/issue, web]
doc_kind: spec
---

# F20260630k229 [issue-collaboration] Close Issue 活动记录

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

Issue 关闭时，系统执行两个操作：(1) 数据库状态更新（设置 `closed_at`、`left_at`）；(2) 资源清理（关闭 PR、删除 worktree、删除分支）。资源清理的结果（哪些成功、哪些失败、哪些跳过）仅通过 HTTP 响应返回并在前端以 toast 形式短暂展示。

**问题**：
1. PropertiesPanel Activity 区域只显示 "created issue" 和 "entered stage"，没有 close event
2. 清理结果（哪些资源成功/失败/跳过）仅 toast 短暂展示，消失后无法查阅

## 目标

1. 给 Issue 模型补充 `close_summary` 字段，与 `closed_at` 配套，记录 close 处理内容
2. PropertiesPanel Activity 区域显示 close event 和清理结果

## 非目标

- 不引入独立的活动日志表或审计系统
- 不记录 close issue 之外的其他活动（如 stage 推进、snail 切换）
- 不改变 `activity_status` 的计算逻辑
- 不改变资源清理的执行逻辑（best-effort、安全校验等）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户关闭 Issue 时 | Issue 应设置 `close_summary`，记录资源清理结果；Activity 区域应显示 close event | `close-activity-recording.test.ts` |
| B2 | 当 Issue 已关闭时重复关闭 | 幂等处理，`closeIssue` 直接返回，不覆盖已有 `close_summary` | `close-activity-recording.test.ts` |
| B3 | 当资源清理全部成功时 | `close_summary` 包含每个资源的 success 状态 | `close-activity-recording.test.ts` |
| B4 | 当部分资源清理失败时 | `close_summary` 包含失败项的 error 信息 | `close-activity-recording.test.ts` |
| B5 | 当无关联资源时 | `close_summary` 记录所有资源为 skipped | `close-activity-recording.test.ts` |
| B6 | 当 close 成功但 cleanup 前进程崩溃时 | `close_summary` 为 null，Activity 区域显示"清理结果未记录" | `close-activity-recording.test.ts` |

## 设计

### 数据模型

**Issue 模型新增字段**：

```typescript
export interface Issue {
  // ... 现有字段 ...
  closed_at: string | null;
  close_summary: CloseSummary | null;  // 新增：与 closed_at 配套
}

export interface CloseSummary {
  pr: { status: "success" | "failed" | "skipped"; error?: string };
  worktree: { status: "success" | "failed" | "skipped"; error?: string };
  localBranch: { status: "success" | "failed" | "skipped"; error?: string };
  remoteBranch: { status: "success" | "failed" | "skipped"; error?: string };
}
```

**`CloseSummary` 在 domain 层独立定义**，结构与 `resource-cleanup.ts` 中的 `CleanupResult` 相同但解耦（domain 不依赖 app 层）。`closed_at` 已在 Issue 级别存在，不需要在 summary 中重复。

### 数据库 Schema

在 `CREATE TABLE IF NOT EXISTS` 中新增 `close_summary TEXT` 列。`close_summary` 存储 JSON 字符串（`CloseSummary` 的序列化），null 表示未关闭或关闭时无清理记录。本系统不考虑迁移，只保持最新版本。

### 写入时机与链路

完整链路（两层分离）：

```
adapter.closeIssue()          ← 事务内：设置 closed_at + left_at
  ↓ 返回 issue
collaboration.closeIssue()    ← 事务外
  ├── WebSocket 通知
  ├── cleanupResources()      ← 异步，涉及 git/gh 命令
  └── issuePort.updateCloseSummary()  ← 独立 DB 操作，cleanup 完成后调用
```

- `adapter.closeIssue()` 在事务内完成数据库状态更新，返回 `Issue`
- `collaboration.closeIssue()` 在事务外执行异步资源清理
- `updateCloseSummary()` 是独立的数据库操作，不在原 `closeIssue` 事务内
- `updateCloseSummary()` 失败仅记录日志，不阻断 close 流程（best-effort）

**幂等性保证**：`closeIssue` 的幂等性由 adapter 保证（已关闭直接返回）。幂等分支不会执行到 `cleanupResources`，因此不会覆盖已有 `close_summary`。

**中断场景**：如果 `closeIssue` 成功设置了 `closed_at`，但进程在 `cleanupResources` 之前崩溃，`close_summary` 为 null。UI 需要处理此情况，显示"清理结果未记录"而非空白。

### 接口变更

**IssuePort** 新增方法：

```typescript
export interface IssuePort {
  // ... 现有方法 ...
  updateCloseSummary(id: string, summary: CleanupResult): void;
}
```

**IssueRepository** 新增方法：

```typescript
export interface IssueRepository {
  // ... 现有方法 ...
  updateCloseSummary(id: string, summary: string): void;
}
```

### PropertiesPanel Activity 展示

修改 `PropertiesPanel.tsx` 的 Activity section，在 stage 进入记录之后增加 close event：

```tsx
{issue.closed_at && (
  <div>
    <ActivityItem name="System" action="closed issue" time={formatRelativeTime(issue.closed_at)} />
    {issue.close_summary && <CloseSummaryDetail summary={issue.close_summary} />}
  </div>
)}
```

`CloseSummaryDetail` 新组件（`PropertiesPanel.tsx` 内部），渲染清理结果摘要：

```
PR: closed | Worktree: failed (有未提交更改) | Branch: deleted
```

- 成功项：绿色/正常色
- 失败项：红色/警告色 + error 信息
- 跳过项：灰色

`close_summary` 为 null 时（中断场景），显示灰色文字"清理结果未记录"。

**为什么用专用组件而非扩展 `ActivityItem`**：`ActivityItem` 是单行文本组件（name + action + time），close summary 是结构化数据，两者形态不同。专用组件保持 `ActivityItem` 的简洁性。

### DTO 透传

`IssueDto` 和 `IssueDetailDto` 需要增加 `close_summary` 字段，使前端能访问。`toIssueDetail()` 映射函数需要传递该字段。

## 设计约束摘要

- **边界**：`close_summary` 仅记录 close issue 的资源清理结果，不扩展到其他事件
- **关键决策**：Issue 模型新增字段而非使用 context——与 `closed_at` 配套，语义清晰
- **语义不变量**：`close_summary` 写入失败不应阻断 close 流程（best-effort）
- **非目标约束**：不改变 activity_status 计算逻辑，不改变资源清理逻辑

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/domain/issue/model.ts` | 修改 | Issue 接口新增 `close_summary` 字段 + CloseSummary 类型 |
| `src/domain/issue/port.ts` | 修改 | IssuePort 新增 `updateCloseSummary()` |
| `src/domain/issue/_internal/repository.ts` | 修改 | IssueRepository 新增 `updateCloseSummary()` + schema 新增 close_summary 列 + mapIssue 映射 |
| `src/domain/issue/_internal/adapter.ts` | 修改 | IssueAdapter 实现 `updateCloseSummary()` |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | `closeIssue()` 清理完成后调用 `updateCloseSummary()` |
| `src/api-contracts/dto.ts` | 修改 | IssueDto 新增 `close_summary` 字段 |
| `src/infra/http/routes/issue.route.ts` | 修改 | `toIssueDetail()` 传递 `close_summary` |
| `src/web/components/PropertiesPanel.tsx` | 修改 | Activity section 增加 close event + CloseSummaryDetail 组件 |

## 验证

### 通用

- [ ] 关闭一个有关联资源的 Issue，确认 `close_summary` 被正确写入数据库
- [ ] 确认 PropertiesPanel Activity 区域显示 close event 和清理结果
- [ ] 关闭一个无关联资源的 Issue，确认 `close_summary` 记录所有资源为 skipped
- [ ] 确认清理失败项在 Activity 中用警告色标注
- [ ] 确认 toast 仍然正常显示（不受影响）
- [ ] 确认重复关闭不覆盖已有 `close_summary`
- [ ] 确认 `npm run check` 通过

## 关联

- **前置**: F20260629qrtu（Close Issue 自动清理关联资源——本 feature 记录的就是清理结果）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 数据存储位置 | Issue 模型新增字段，与 closed_at 配套，语义清晰 | 需要 schema migration | Issue 模型字段 | 与 closed_at 配套是自然设计；SQLite ALTER TABLE 无风险 | 架构师-1, 架构师-2 | 2026-06-30 |
| D2 | 写入时机 | 资源清理完成后写入（事务外），与 cleanupResources 保持一致 | 应在事务内保证原子性 | 事务外 | 清理结果在事务提交后才能获得；写入失败不阻断 close | 架构师-1, 架构师-2 | 2026-06-30 |
| D3 | UI 展示位置 | PropertiesPanel Activity 区域，与 "created issue" 一致 | 消息流中也可展示 | PropertiesPanel Activity | 与现有 Activity 条目保持一致的数据来源 | 架构师-1, 架构师-2 | 2026-06-30 |
| D4 | 中断场景处理 | 接受丢失（选 A），UI 显示"清理结果未记录" | 应在事务内先写 pending 状态 | 接受丢失 | close 的核心语义是关闭 issue，summary 是锦上添花；pending 状态增加复杂度 | 架构师-1, 架构师-2 | 2026-06-30 |
| D5 | CloseSummary 类型 | domain 层独立定义，结构与 CleanupResult 相同但解耦 | 应直接复用 CleanupResult | domain 层独立定义 | domain 不依赖 app 层 | 架构师-1, 架构师-2 | 2026-06-30 |
