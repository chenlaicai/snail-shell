---
id: F20260702m7kp
title: closePr 状态感知：区分 merged/open/closed
status: implemented
created_at: 2026-07-02
---

# F20260702m7kp — closePr 状态感知

## 概述

当前 `closePr()` 无条件调用 `gh pr close`，不区分 PR 实际状态。正常流程中 PR 已合入后再关闭 Issue，此时对已合入的 PR 执行 `gh pr close` 语义错误。本 Feature 使 PR 清理逻辑感知 PR 状态，按状态执行正确操作。

## 核心业务行为

1. **当** PR 已合入（MERGED）时，**应该** 跳过关闭操作，记录 `merged` 状态
2. **当** PR 处于开放状态（OPEN）时，**应该** 执行 `gh pr close`，记录 `closed` 状态
3. **当** PR 已关闭（CLOSED）时，**应该** 跳过关闭操作，记录 `skipped` 状态
4. **当** PR 不存在时，**应该** 跳过，记录 `skipped` 状态（与当前行为一致）
5. **当** 状态查询失败时，**应该** 回退到当前行为（直接调用 `gh pr close`），不阻断清理流程

## 设计方案

### PR 状态查询

在 `closePr()` 执行前，先调用 `gh pr view <url> --json state` 获取 PR 状态：

```
1. 调用 gh pr view <url> --json state
2. 根据返回的 state 字段分支：
   - MERGED → 记录 merged，跳过 close
   - OPEN   → 执行 gh pr close，记录 closed
   - CLOSED → 记录 skipped，跳过 close
3. 查询失败（网络错误、PR 不存在等）→ 回退到现有行为
```

### ResourceStatus 类型扩展

类型定义存在于**三处**，必须同步更新：

| 位置 | 文件 | 当前定义 |
|------|------|----------|
| 资源清理模块 | `src/app/issue-collaboration/resource-cleanup.ts:7` | `"success" \| "failed" \| "skipped"` |
| 领域模型 | `src/domain/issue/model.ts` (CloseSummary) | 内联字面量，同上 |
| API DTO | `src/api-contracts/dto.ts:67-74` | 含 `"pending"` |

扩展后：

```typescript
// resource-cleanup.ts & model.ts
type ResourceStatus = "success" | "failed" | "skipped" | "merged" | "closed";

// dto.ts（含 pending）
type ResourceStatusDto = "success" | "failed" | "skipped" | "pending" | "merged" | "closed";
```

- `merged`：PR 已合入，无需操作（仅用于 PR 资源）
- `closed`：PR 被本次清理操作关闭（仅用于 PR 资源）
- `success`：非 PR 资源的清理成功
- `skipped`：资源不存在或无需操作
- `failed`：清理失败

**设计决策**：保留 `success` 用于 worktree/branch 清理，PR 清理使用更语义化的 `merged`/`closed`。这使 `close_summary` 能准确反映实际情况，前端可以展示更精确的状态文案。

### 日志区分

| PR 状态 | 当前日志 | 目标日志 |
|---------|---------|---------|
| MERGED | `cleanup.pr.closed`（误导） | `cleanup.pr.merged` |
| OPEN → close 成功 | `cleanup.pr.closed` | `cleanup.pr.closed` |
| CLOSED | `cleanup.pr.closed`（误导） | `cleanup.pr.already_closed` |
| 不存在 | `cleanup.pr.not_found` | `cleanup.pr.not_found` |
| 查询失败 → 回退 → close 成功 | N/A | `cleanup.pr.closed_fallback` |
| 查询失败 → 回退 → close 失败 | N/A | `cleanup.pr.failed_fallback` |

回退路径日志加 `_fallback` 后缀，避免与正常 close 混淆，降低排查成本。

### 前端展示适配

close_summary toast 需要识别新状态：

| status | 展示文案 |
|--------|---------|
| `merged` | "PR 已合入" |
| `closed` | "PR 已关闭" |
| `success` | "已清理"（worktree/branch） |
| `skipped` | "跳过" |
| `failed` | "失败：{error}" |

**需要修改的前端渲染函数**（两处）：

1. **`StageActionBar.tsx` — `formatCleanupResult`**：当前只有 `success`/`skipped`/`else` 三分支，`merged`/`closed` 会命中 `else` 显示为"失败"（回归 bug）。需增加 `merged` → "PR 已合入"、`closed` → "PR 已关闭" 分支。

2. **`PropertiesPanel.tsx` — `CloseSummaryDetail`**：当前 `skipped` 显示 muted、`failed` 显示红色、其余绿色 "ok"。`merged` 会显示绿色 "ok"（语义可接受但不精确），`closed` 同理。需增加 `merged`/`closed` 的独立展示分支。

## 关键设计取舍

### 取舍 1：查询失败时的回退策略

**选项 A**：查询失败则跳过 PR 清理（记录 `skipped`）
- 优点：不执行任何可能不正确的操作
- 缺点：网络抖动导致本该关闭的 OPEN PR 未被清理

**选项 B**：查询失败则回退到现有行为（直接 `gh pr close`）（当前选择）
- 优点：best-effort 原则，尽量清理
- 缺点：可能对已合入 PR 执行 close（但 GitHub 容忍，无副作用）

**决策**：选择选项 B，因为：
1. 与现有 best-effort 清理策略一致
2. `gh pr close` 对已合入 PR 无副作用
3. 网络抖动比 PR 状态不一致更常见

### 取舍 2：状态查询的额外网络开销

**问题**：每次 closeIssue 多一次 `gh pr view` 调用。

**分析**：
- closeIssue 是低频操作（用户手动触发）
- `gh pr view --json state` 是轻量查询，通常 < 1s
- 准确性收益远大于性能开销

**决策**：接受额外查询，不设缓存。

## 实现约束

1. **向后兼容**：`ResourceStatus` 扩展不影响现有 `success`/`failed`/`skipped` 语义
2. **前端兼容**：`merged` 和 `closed` 状态在前端需要有对应展示，不能 fallback 到 "未知"
3. **幂等性**：重复调用 closeIssue 对已合入 PR 不应产生任何操作
4. **不阻断清理**：PR 状态查询失败不应阻断 worktree/branch 清理
5. **旧数据兼容**：旧 `close_summary` 中的 `success` 不会被迁移为 `merged`，前端需对未知状态值有 fallback 渲染

## 验收标准

1. **gh CLI 行为验证**：验证 `gh pr close <merged-pr-url>` 的 exit code 和 stderr，确认回退路径的安全性
2. **类型同步**：三处类型定义（resource-cleanup、domain model、DTO）均已更新，TypeScript 编译通过
3. **前端覆盖**：`formatCleanupResult` 和 `CloseSummaryDetail` 均正确处理 `merged`/`closed` 状态
4. **回退路径日志**：查询失败时日志标记 `_fallback` 后缀
5. **幂等验证**：对已关闭 Issue 重复调用 closeIssue，close_summary 不变

## 不兼容更新

无。`ResourceStatus` 是类型扩展（新增可选值），不破坏现有消费方。旧 `close_summary` 中的 `success` 保持不变，前端对未识别的状态值应有 fallback 渲染（显示为 "已清理"）。
