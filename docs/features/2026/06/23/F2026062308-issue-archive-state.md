---
id: F2026062308
title: issue-archive-state
from_ids: []
tags: [issue, archive, lifecycle]
modules: [domain/issue, api, web]
doc_kind: spec
---

# F2026062308 [issue] Issue 归档状态

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 Issue 的生命周期终止机制是 `closed_at` 字段：`archiveIssue()`/`completeIssue()` 设置 `closed_at` 时间戳并清理 worktree/分支资源。但这存在两个问题：

1. **语义模糊**：`closed_at` 同时表示"自然完成"和"主动归档"，无法区分正常结束与强制归档
2. **写保护不完整**：当前 `sendMessage()` 不检查 `closed_at`，理论上仍可向已关闭 issue 发送消息；前端仅通过 `StageActionBar` 隐藏推进按钮，未在消息输入层面拦截
3. **缺少任意阶段归档能力**：用户希望在 issue 的任何 stage 都能直接归档，而非只能在流程结束后关闭

用户需求：增加一个独立的"归档"状态，UI 上随时可将任何 stage 的 issue 点击归档按钮，进入归档状态后 issue 完全不可变。

## 目标

为 Issue 增加独立的 `archived_at` 字段，表达"强制归档"语义：

- **P1 — 核心归档能力**：新增 `archived_at` 字段 + `archiveIssue()` API + 归档写保护 + UI 归档按钮
- 归档后 issue 完全不可变：禁止发送消息、禁止 stage 推进、禁止修改元数据
- 归档按钮在任何 stage 的 issue 详情页可见

## 非目标

- 不改变现有 `closed_at` 的语义和行为（自然完成流程不变）
- 不提供"取消归档"能力（归档是单向操作）
- 不改变 stage 的 `left_at` 语义（归档不等于当前 stage 完成）
- 不在本 feature 中实现 worktree/branch 清理逻辑（当前 Issue 域未记录 worktree/branch 信息，待 `output_artifacts` 记录机制完善后再统一清理）

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当用户对任意 stage 的 issue 点击归档按钮时 | 系统设置 `archived_at` 为当前时间，issue 进入归档状态 |
| B2 | 当 issue 已归档时，用户尝试发送消息 | 系统拒绝操作，返回错误提示"issue 已归档，不可修改" |
| B3 | 当 issue 已归档时，用户尝试推进 stage | 系统拒绝操作，StageActionBar 不显示或显示只读状态 |
| B4 | 当 issue 已归档时，AI 尝试发送 stage_transition 建议 | 系统忽略建议，不存储不推送 |
| B5 | 当 issue 已归档时，前端显示 issue 详情 | 显示归档标记，消息输入框隐藏，所有操作按钮禁用 |
| B6 | 当用户归档一个有活跃 stage 的 issue 时 | 系统归档 issue，但不自动完成当前 stage（`left_at` 保持 null）；状态推导时 `archived_at` 优先级高于 `left_at` |
| B7 | 当用户对已关闭（`closed_at != null`）的 issue 点击归档时 | 系统设置 `archived_at`，两个字段同时非 null，`archived_at` 语义优先 |
| B8 | 当系统重启恢复（startupRecovery）时 | 已归档 issue 的 stage 不应被重新入队处理 |

## 设计

### 数据模型变更

**Issue 表新增字段**：

```sql
ALTER TABLE issue ADD COLUMN archived_at TEXT;
```

**Issue 接口变更**（`src/domain/issue/model.ts`）：

```typescript
export interface Issue {
  // ... 现有字段
  closed_at: string | null;
  archived_at: string | null;  // 新增：null = 未归档, 非 null = 已归档
}
```

**设计取舍：`archived_at` vs 复用 `closed_at`**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 新增 `archived_at` | 语义清晰，与 `closed_at` 正交；归档和关闭是独立概念 | 多一个字段，状态组合增加 |
| 复用 `closed_at` + `close_reason` | 不增加字段数 | 需要改 `closed_at` 的语义，影响现有逻辑 |
| 新增 `status` 枚举 | 单一字段表达所有状态 | 与历史设计决策矛盾（F2026052303 移除了 status） |

**决策**：采用 `archived_at` 方案。归档是独立于关闭的操作——用户可以在 issue 未完成时强制归档，这与自然关闭语义不同。

### 写保护机制

**核心守卫函数**（新增于 `src/domain/issue/_internal/adapter.ts`）：

```typescript
function assertIssueMutable(issue: Issue): void {
  if (issue.archived_at) {
    throw new Error(`Issue "${issue.id}" is archived and cannot be modified`);
  }
}
```

**写保护检查点**：

**核心拦截策略**：`drainStage()` 是所有异步写操作的汇聚点，在此处做归档检查可一次性拦截所有 agent 调用链。

| 检查点 | 文件 | 层级 | 说明 |
|--------|------|------|------|
| `drainStage()` | `collaboration.ts` | 应用层 | **核心拦截点**：stage 队列消费循环入口，拦截后所有异步 agent 调用 |
| `sendMessage()` | `collaboration.ts` | 应用层 | 用户主动发送消息前检查 |
| `enqueueStage()` | `collaboration.ts` | 应用层 | stage 入队前检查，防止归档后 stage 被排队 |
| `invokeAgent()` | `collaboration.ts` | 应用层 | agent 调用前检查，防御性兜底 |
| `detectStageTransition()` | `collaboration.ts` | 应用层 | 生成建议前检查，归档后不产生建议 |
| `advanceStage()` | `adapter.ts` | 域层 | 推进 stage 前检查 |
| `switchSnail()` | `adapter.ts` | 域层 | 切换 snail 前检查 |
| `addOutputArtifacts()` | `adapter.ts` | 域层 | 写入产物前检查 |
| `createStage()` | `adapter.ts` | 域层 | 创建新 stage 前检查 |
| `setSnailInstanceId()` | `adapter.ts` | 域层 | 修改 snail 实例前检查 |
| `startupRecovery()` | `startup-recovery.ts` | 基础设施 | 重启恢复时过滤已归档 issue 的 stage，不重新入队 |
| `interruptMessage()` | `collaboration.ts` | 应用层 | 归档后不再允许中断消息操作 |

### API 变更

**新增端点**：

```
POST /issues/:issueId/archive
```

请求体：无（或可选 `reason` 字段）
响应：更新后的 Issue DTO

**实现逻辑**：
1. 查找 issue，不存在则 404
2. 已归档则幂等返回（不报错）
3. 设置 `archived_at = new Date().toISOString()`
4. 通过 WebSocket 推送 issue 更新事件

**注意**：worktree/branch 清理不在本 feature 范围内。当前 Issue 域的 `output_artifacts` 未记录 worktree/branch 信息，待记录机制完善后统一实现清理。

### 前端变更

**Issue 详情页**（`IssueConversation.tsx` / `PropertiesPanel.tsx`）：

1. 归档按钮：在 issue 详情页 header 区域添加"归档"按钮，不依赖当前 stage
2. 归档标记：`PropertiesPanel` 显示 `Archived: {date}`
3. 写保护 UI：
   - `archived_at !== null` 时隐藏消息输入框
   - `StageActionBar` 不渲染（已通过 `issue.closed_at` 检查，需扩展到 `archived_at`）
   - 显示只读提示："此 Issue 已归档，历史对话保留为只读。"

**Issue 列表页**（`issue-utils.ts` / `StatusBadge.tsx`）：

- `statusColumns` 新增 `archived` 状态列
- `StatusBadge` 新增 `archived` 样式（灰色标记）

**Issue 状态推导逻辑**：

```typescript
// 推导 issue 级别的显示状态
function deriveIssueStatus(issue: Issue, currentStage: Stage): string {
  if (issue.archived_at) return "archived";
  if (issue.closed_at) return "completed";
  if (currentStage.left_at) return "completed";
  return "in_progress";
}
```

### 归档与关闭的语义区别

| 维度 | 关闭（closed_at） | 归档（archived_at） |
|------|-------------------|---------------------|
| 触发条件 | 流程自然结束 / 手动完成 | 用户随时主动归档 |
| Stage 状态 | 当前 stage 通常已完成 | 当前 stage 可能仍在进行中 |
| 写保护 | 部分（前端隐藏按钮，后端不强制） | 完全（前后端双重强制） |
| 资源清理 | 清理 worktree/branch | 同上（复用同一清理逻辑） |
| 可逆性 | 不可逆 | 不可逆 |

### 归档与关闭的交互语义

两个字段正交，可同时非 null：

| closed_at | archived_at | 状态 | 说明 |
|-----------|-------------|------|------|
| null | null | 活跃 | 正常进行中 |
| 非 null | null | 已关闭 | 自然完成，可后续归档 |
| null | 非 null | 已归档 | 强制冻结（可能 stage 仍在进行） |
| 非 null | 非 null | 已归档 | 关闭后再归档，`archived_at` 语义优先 |

**状态推导优先级**：`archived_at > closed_at > stage.left_at`。当 `archived_at !== null` 时，无论 `closed_at` 和 `stage.left_at` 如何，issue 状态均为 `archived`。

## 生效路径

- **代码**：`src/domain/issue/model.ts`、`src/domain/issue/_internal/adapter.ts`、`src/domain/issue/_internal/repository.ts`、`src/app/issue-collaboration/collaboration.ts`
- **API**：`src/infra/http/routes/issue.route.ts`、`src/api-contracts/endpoints.ts`、`src/api-contracts/dto.ts`
- **前端**：`src/web/pages/IssueConversation.tsx`、`src/web/components/PropertiesPanel.tsx`、`src/web/components/StageActionBar.tsx`、`src/web/components/StatusBadge.tsx`、`src/web/lib/issue-utils.ts`
- **迁移**：SQLite ALTER TABLE 迁移脚本

## 设计约束摘要

- **边界**：`archived_at` 与 `closed_at` 正交，不改变现有关闭语义；状态推导优先级 `archived_at > closed_at > stage.left_at`
- **关键决策**：归档是单向操作，不提供取消归档能力；归档不自动完成当前 stage；`drainStage()` 为核心写保护拦截点
- **非目标约束**：不改变 stage 的 `left_at` 语义；不改变现有 `archiveIssue`/`completeIssue` 的行为
- **语义不变量**：`archived_at !== null` 的 issue 必须完全不可变（消息、stage、元数据均不可修改）；`startupRecovery` 必须过滤已归档 issue

<!-- [design-time] 章节结束 -->

## 改动范围

| 层 | 文件 | 变更类型 |
|----|------|----------|
| Domain Model | `src/domain/issue/model.ts` | 新增 `archived_at` 字段 |
| Repository | `src/domain/issue/_internal/repository.ts` | Schema 迁移 + CRUD 适配 |
| Adapter | `src/domain/issue/_internal/adapter.ts` | 新增 `archiveIssue()` + `assertIssueMutable()` |
| Port | `src/domain/issue/port.ts` | 新增 `archiveIssue` 端口方法 |
| Collaboration | `src/app/issue-collaboration/collaboration.ts` | drainStage/sendMessage/interruptMessage/enqueueStage/advanceStage 写保护 |
| Startup Recovery | `src/app/issue-collaboration/startup-recovery.ts` | 过滤已归档 issue 的 stage |
| API Contract | `src/api-contracts/dto.ts`、`endpoints.ts` | 新增 archive 端点和 DTO 字段 |
| HTTP Route | `src/infra/http/routes/issue.route.ts` | 新增 POST /issues/:id/archive |
| Frontend | 多个前端组件 | 归档按钮 + 状态显示 + 写保护 UI |

## 验证

### P1

- [ ] 归档 API 可正常调用，返回更新后的 issue
- [ ] 归档后发送消息被拒绝（返回错误）
- [ ] 归档后 stage 推进被拒绝
- [ ] 归档后 `drainStage()` 拦截，不调用 agent
- [ ] 归档后 UI 隐藏输入框和操作按钮
- [ ] 任意 stage 均可归档（design/development/review 等）
- [ ] 已归档 issue 重复归档幂等返回
- [ ] 已关闭 issue 可再归档（`closed_at` + `archived_at` 同时非 null）
- [ ] 归档后 issue 列表显示 archived 状态标记
- [ ] 系统重启后，已归档 issue 的 stage 不被重新入队（startupRecovery 过滤）

## 关联

- **相关**: F2026052303（移除 FeatureStatus，closed_at 语义）
- **相关**: F2026060109（归档清理修复，cleanupFeatureAllStages）
- **相关**: F2026060111（Feature→Issue 重命名，archive API 路径）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 归档状态的存储方式 | `archived_at` 字段语义清晰，与 `closed_at` 正交，不影响现有逻辑 | 增加字段数，状态组合变复杂 | 采用 `archived_at` | 归档与关闭是独立概念，用户需求明确区分两者；F2026052303 已移除 status 枚举，不宜重新引入 | 架构师-1, 架构师-2 | 2026-06-23 |
| D2 | 归档时是否自动完成当前 stage | 自动完成语义明确，归档后 stage 状态统一 | 用户可能只想冻结而非结束当前阶段；自动完成会改变 stage 历史 | 不自动完成 | 归档是"冻结"语义，不是"结束"语义；stage 的 `left_at` 应反映真实的阶段结束，而非强制归档 | 架构师-1, 架构师-2 | 2026-06-23 |
| D3 | 是否提供取消归档能力 | 提供可逆操作更灵活 | 归档语义是"最终状态"，可逆会模糊边界；增加复杂度 | 不提供 | 归档是单向操作，与 `closed_at` 保持一致的不可逆语义 | 架构师-1, 架构师-2 | 2026-06-23 |
| D4 | 写保护核心拦截点选择 | 在 `drainStage()` 入口拦截可一次性覆盖所有异步 agent 调用链 | 单点拦截可能遗漏同步写操作；需配合域层检查 | `drainStage()` 为核心拦截点 + 域层各写操作防御性检查 | `drainStage()` 是所有异步写操作的汇聚点（enqueueStage → drainStage → invokeAgent），在此拦截效率最高；域层检查作为防御性兜底 | 架构师-1, 架构师-2 | 2026-06-23 |
