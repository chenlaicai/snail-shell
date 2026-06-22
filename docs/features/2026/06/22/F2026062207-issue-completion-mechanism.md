---
id: F2026062207
title: issue-completion-mechanism
from_ids: []
tags: []
modules: []
doc_kind: spec
---

# F2026062207 [issue] Issue 完成机制

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 Issue 生命周期存在三个相互关联的问题：

1. **`merge` 阶段完成后 Issue 无终态**：`merge` 是 code-delivery SOP 的最后阶段。当 `merge` 完成（`left_at` 被设置）后，`currentStage.status` 变为 `"completed"`，但 Issue 本身没有任何标记。`closed_at` 字段存在但**没有任何代码路径会设置它**。Issue 在看板上显示为 "Done"，但这只是从 `current_stage.status` 推导的，不是 Issue 级别的状态。

2. **终端阶段的 "Advance Stage" 语义错误**：在 `merge` 阶段**进行中**时，`StageActionBar` 显示的可用转换只有 `merge -> review`（打回路径）。按钮文案是 "Advance Stage"，但从业务语义上这是**回滚**。

3. **单阶段 SOP 的终态问题**：`evolution`（单 `development` 阶段）和 `general-assistant`（单 `chat` 阶段）没有定义任何 transitions。这些阶段完成后，Issue 同样无法标记为完成。

**根因**：当前架构有一个根本性的缺口——stage 推进机制（`advanceStage`）和 Issue 完成机制是两件不同的事，但后者从未实现。

**历史教训**：PR #410 尝试实现此功能，但开发者把代码写到了 `v1/` 目录下（旧版本代码），而不是 `src/` 目录下（当前主代码）。审查者未发现此严重错误，导致 PR 被关闭。本次设计必须确保代码写在正确的位置。

## 目标

1. 为 Issue 增加完成状态，通过设置 `closed_at` 字段实现
2. 区分正向转换（Advance）和反向转换（Bounce），在 UI 中明确语义
3. 支持终端阶段和单阶段 SOP 的 Issue 完成

## 非目标

1. **不实现 reopen**：Issue 完成后重新打开是独立的生命周期操作，不在本次 scope 内
2. **不实现 stage gate 作为 Issue 完成的代码前置条件**：stage gate 是独立的质量保障机制，与 Issue 完成分离
3. **不改变现有 SOP 结构**：不修改 YAML schema、不增加 `sequence` 字段到 domain model
4. **不处理非线性 SOP**：当前所有 SOP 都是线性的，分支 SOP 的处理不在本次 scope 内

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 Issue 的当前阶段是终端阶段（`available_transitions` 中无正向转换）且阶段仍进行中时 | 可以调用 `completeStage` 完成阶段 | `tests/domain/issue/completeStage-completeIssue-test.ts::B1` |
| B2 | 当终端阶段已完成（`left_at` 已设置）且 `closed_at` 为 null 时 | 可以调用 `completeIssue` 完成 Issue | `tests/domain/issue/completeStage-completeIssue-test.ts::B2` |
| B3 | 当阶段有正向转换时 | 调用 `completeStage` 应拒绝，返回错误 "Stage is not a terminal stage" | `tests/domain/issue/completeStage-completeIssue-test.ts::B3` |
| B4 | 当阶段进行中时（`left_at` 为 null） | 调用 `completeIssue` 应拒绝，返回错误 "Stage is still in progress" | `tests/domain/issue/completeStage-completeIssue-test.ts::B4` |
| B5 | 当 SOP 只有一个阶段且无任何转换时 | 阶段进行中可调用 `completeStage`，完成后可调用 `completeIssue` | `tests/domain/issue/completeStage-completeIssue-test.ts::B5` |
| B6 | 当判断阶段是否为终端阶段时 | 使用 `sop_snapshot.stage_definitions` 数组索引判断：`available_transitions` 中不存在 `targetIndex > currentIndex` 的转换 | `tests/domain/issue/completeStage-completeIssue-test.ts::B6` |
| B7 | 当阶段有反向转换但无正向转换时 | 仍为终端阶段，可调用 `completeStage` | `tests/domain/issue/completeStage-completeIssue-test.ts::B7` |
| B8 | 当 Issue 已完成（`closed_at` 非空）时 | 调用 `completeStage`、`completeIssue`、`advanceStage` 都应拒绝，返回错误 "Issue is already completed" | `tests/domain/issue/completeStage-completeIssue-test.ts::B8` |
| B9 | 当阶段已完成（`left_at` 非空）时 | 调用 `completeStage` 应拒绝，返回错误 "Stage is already completed" | `tests/domain/issue/completeStage-completeIssue-test.ts::B9` |

## 设计

### 架构约束

**代码必须写在 `src/` 目录下**，遵循项目的 DDD 分层架构：

- **Domain 层**：`src/domain/issue/_internal/adapter.ts` - 核心业务逻辑
- **App 层**：`src/app/issue-collaboration/collaboration.ts` - 应用层协调
- **Infra 层**：`src/infra/http/routes/issue.route.ts` - HTTP 路由
- **测试**：`tests/` 目录（非 `v1/tests/`）

### 终端阶段判定

一个阶段是终端阶段，当且仅当：**从该阶段出发的所有 `available_transitions` 中，不存在正向转换**。

判断正向/反向的逻辑使用 `sop_snapshot.stage_definitions` 数组索引：
```
currentIndex = stage_definitions.findIndex(d => d.key === currentStage.key)
targetIndex = stage_definitions.findIndex(d => d.key === targetKey)
isForward = targetIndex > currentIndex
```

对于无任何转换的阶段（如 `evolution` 的 `development`），`available_transitions` 为空，自然满足终端条件。

### completeStage 操作

**适用范围**：仅终端阶段（无正向转换）

**行为**：
- 设置 `left_at` 为当前时间
- 不创建新阶段
- 不设置 `closed_at`

**前置条件**（全部必须满足）：
1. Issue 未完成（`closed_at` 为 null）——否则拒绝，返回 "Issue is already completed"
2. 当前阶段进行中（`left_at` 为 null）——否则拒绝，返回 "Stage is already completed"
3. 当前阶段是终端阶段（`available_transitions` 中不存在正向转换）——否则拒绝，返回 "Stage is not a terminal stage"

**与 advanceStage 的区别**：
- `advanceStage`：从当前阶段转移到目标阶段（创建新阶段）
- `completeStage`：标记终端阶段完成（不创建新阶段）

**实现位置**：
- Domain 层：`src/domain/issue/port.ts` 新增接口方法
- Domain 层：`src/domain/issue/_internal/adapter.ts` 新增实现
- App 层：`src/app/issue-collaboration/port.ts` 新增接口方法
- App 层：`src/app/issue-collaboration/collaboration.ts` 新增实现
- Infra 层：`src/infra/http/routes/issue.route.ts` 新增路由

### completeIssue 操作

**行为**：
- 设置 `closed_at` 为当前时间
- 不修改任何阶段状态

**前置条件**（全部必须满足）：
1. Issue 未完成（`closed_at` 为 null）——否则拒绝，返回 "Issue is already completed"
2. 当前阶段已完成（`left_at` 非空）——否则拒绝，返回 "Stage is still in progress"

**独立性**：`completeIssue` 是独立于 `advanceStage` 和 `completeStage` 的操作，专门用于 Issue 生命周期管理。

**实现位置**：
- Domain 层：`src/domain/issue/port.ts` 新增接口方法
- Domain 层：`src/domain/issue/_internal/adapter.ts` 新增实现
- App 层：`src/app/issue-collaboration/port.ts` 新增接口方法
- App 层：`src/app/issue-collaboration/collaboration.ts` 新增实现
- Infra 层：`src/infra/http/routes/issue.route.ts` 新增路由

### 看板状态

Issue 状态推导逻辑：
- `closed_at` 非空 → Issue 状态为 "completed"
- `closed_at` 为 null → Issue 状态由 `current_stage.status` 推导（现有逻辑）

## 生效路径

本 feature 的规则通过以下入口生效：
1. **代码**：`completeStage` 和 `completeIssue` 的 API 端点和业务逻辑
2. **前端**：`StageActionBar` 组件的按钮文案和交互逻辑（**拆分至后续 PR**）
3. **看板**：`issue-utils` 中的状态推导逻辑（**拆分至后续 PR**）

## 设计约束摘要

- **边界**：
  - `completeStage` 仅适用于终端阶段（无正向转换）
  - `completeIssue` 仅在终端阶段完成后可用
  - 不实现 reopen，`closed_at` 一旦设置不可撤销（本次 scope）
  - **代码必须写在 `src/` 目录下**，遵循 DDD 分层架构

- **关键决策**：
  - Issue 完成是独立操作（`completeIssue`），不嵌入 `advanceStage`
  - 正向/反向判断用数组索引，不引入 `sequence` 字段
  - 终端阶段判定逻辑放在 Domain 层，供业务逻辑调用

- **非目标约束**：
  - 不实现 reopen
  - 不实现 stage gate 作为代码前置条件
  - 不处理非线性 SOP

- **语义不变量**：
  - `advanceStage` 语义不变：从当前阶段转移到目标阶段
  - `completeStage` 语义：标记终端阶段完成，不创建新阶段
  - `completeIssue` 语义：设置 `closed_at`，关闭 Issue 生命周期

### 任务锚

#### 本质目标
为 Issue 增加完成状态，通过设置 `closed_at` 字段实现，区分正向转换（Advance）和反向转换（Bounce），支持终端阶段和单阶段 SOP 的 Issue 完成。

#### 反目标
- 不实现 reopen：Issue 完成后重新打开是独立的生命周期操作
- 不实现 stage gate 作为 Issue 完成的代码前置条件
- 不改变现有 SOP 结构
- 不处理非线性 SOP

#### 语义不变量
- `advanceStage` 语义不变：从当前阶段转移到目标阶段
- `completeStage` 语义：标记终端阶段完成，不创建新阶段
- `completeIssue` 语义：设置 `closed_at`，关闭 Issue 生命周期
- 终端阶段判定：从该阶段出发的所有 `available_transitions` 中，不存在正向转换

#### 成功标准
- 终端阶段进行中可调用 `completeStage` 完成阶段
- 终端阶段已完成可调用 `completeIssue` 完成 Issue
- `completeStage` 正确设置 `left_at`
- `completeIssue` 正确设置 `closed_at`
- 单阶段 SOP（evolution、general-assistant）支持完成
- 看板状态正确反映 Issue 完成状态
- 现有 `advanceStage` 行为不受影响
- **代码写在正确的目录下（src/）**

#### 变更类型
`feature` — 新增 completeStage 和 completeIssue 方法，新增终端阶段判定逻辑，新增 API 端点

#### 验证命令预定义
```bash
# 1. 运行测试
cd tests && npx tsx workspace/stage-cycle-test.ts

# 2. 验证代码位置（确保没有写到 v1/ 目录）
grep -r "completeStage\|completeIssue" v1/ && echo "ERROR: Code found in v1/" || echo "OK: No code in v1/"

# 3. 验证 API 端点存在
grep -r "complete-stage\|complete-issue" src/infra/http/routes/

# 4. 验证 Domain 层接口存在
grep -r "completeStage\|completeIssue" src/domain/issue/port.ts
```

<!-- [design-time] 章节结束 -->

## 改动范围

| 层 | 文件 | 变更 |
|---|------|------|
| Domain | `src/domain/issue/port.ts` | 新增 `completeStage` 和 `completeIssue` 接口方法 |
| Domain | `src/domain/issue/_internal/adapter.ts` | 新增 `completeStage` 和 `completeIssue` 实现，新增 `isTerminalStage` 判定方法 |
| App | `src/app/issue-collaboration/port.ts` | 新增 `completeStage` 和 `completeIssue` 接口方法 |
| App | `src/app/issue-collaboration/collaboration.ts` | 新增 `completeStage` 和 `completeIssue` 实现 |
| Infra | `src/infra/http/routes/issue.route.ts` | 新增 `POST /stages/:stageId/complete` 和 `POST /issues/:issueId/complete` 路由 |
| Tests | `tests/domain/issue/` | 新增 `completeStage` 和 `completeIssue` 测试用例 |

## 验证

### P1 - 正常流程
- [ ] 终端阶段进行中可调用 `completeStage` 完成阶段
- [ ] 终端阶段已完成可调用 `completeIssue` 完成 Issue
- [ ] `completeStage` 正确设置 `left_at`
- [ ] `completeIssue` 正确设置 `closed_at`
- [ ] 单阶段 SOP（evolution、general-assistant）支持完成

### P2 - 边界情况
- [ ] 非终端阶段调用 `completeStage` 应拒绝，返回 "Stage is not a terminal stage"
- [ ] 阶段进行中调用 `completeIssue` 应拒绝，返回 "Stage is still in progress"
- [ ] Issue 已完成时调用 `completeStage`、`completeIssue`、`advanceStage` 都应拒绝，返回 "Issue is already completed"
- [ ] 阶段已完成时调用 `completeStage` 应拒绝，返回 "Stage is already completed"
- [ ] 有反向转换但无正向转换的阶段可调用 `completeStage`

### P3 - 回归验证
- [ ] 看板状态正确反映 Issue 完成状态
- [ ] 现有 `advanceStage` 行为不受影响
- [ ] **代码写在正确的目录下（src/）**

## 关联

无前置或阻塞依赖。

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | Issue 完成是独立操作还是 stage 推进的副作用？ | 独立操作语义清晰；适用于所有 SOP（包括单阶段）；与 `closed_at` 字段直接对应 | 需要新增 API 端点 | 独立的 `completeIssue` 操作 | 语义清晰，与现有字段对应，适用于所有 SOP | 架构师-1, 架构师-2 | 2026-06-22 |
| D2 | 如何区分正向和反向转换？ | 用 `stage_definitions` 数组索引：不需要改 domain model，不需要改解析逻辑 | 用 SOP YAML 显式标记 `direction`：更精确但增加配置负担 | 用数组索引判断 | 更简单，不需要改 domain model | 架构师-1, 架构师-2 | 2026-06-22 |
| D3 | 终端阶段进行中时是否允许直接完成 Issue？ | 允许可以减少操作步骤 | 两步操作分离质量保障（stage gate）和生命周期管理（issue completion）；如果允许跳过 gate，gate 机制形同虚设 | 阶段必须先完成才能完成 Issue | 分离关注点，保持 gate 机制有效性 | 架构师-1, 架构师-2 | 2026-06-22 |
| D4 | `completeStage` 适用范围 | 仅终端阶段：语义清晰，与 `advanceStage` 分工明确 | 所有阶段都可以调用：更灵活但可能破坏流程完整性 | 仅终端阶段（无正向转换） | 保持语义清晰，防止中间阶段被跳过 | 架构师-1, 架构师-2 | 2026-06-22 |
| D5 | 代码应该写在哪个目录？ | `src/` 目录是当前主代码，遵循 DDD 分层架构 | `v1/` 目录是旧版本代码，不应再使用 | `src/` 目录 | 项目架构规范，PR #410 的教训 | 架构师-1, 架构师-2 | 2026-06-22 |
| D6 | 是否在本次 scope 中实现 reopen？ | 对称操作一起做更完整 | reopen 是独立的生命周期特性，聚焦核心需求；`closed_at` 基础设施已就位，未来可独立实现 | 排除出本次 scope | 聚焦核心需求，降低复杂度 | 架构师-1, 架构师-2 | 2026-06-22 |
| D7 | 终端阶段判定是否需要防御性校验？ | 添加校验可以防止 SOP 配置错误导致误判 | 当前所有 SOP 都是线性的，且手工维护 YAML，配置错误概率低；添加校验增加复杂度 | 信任 `stage_definitions` 顺序，不额外校验 | 简单性优先，当前 SOP 都是手工维护的线性流程 | 架构师-1, 架构师-2 | 2026-06-22 |
| D8 | 并发操作如何处理？ | 使用乐观锁可以防止并发冲突 | 当前 `advanceStage` 也没有并发控制，保持一致；本次 scope 聚焦核心功能 | 本次 scope 不处理并发，由上层保证串行化 | 保持与现有行为一致，降低复杂度 | 架构师-1, 架构师-2 | 2026-06-22 |

## 范围变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-06-22 | 前端变更（StageActionBar、issue-utils、IssueConversation）拆分至后续 PR | 后端逻辑独立可交付，前端依赖 UI 设计稿，拆分降低 PR 复杂度 |
| 2026-06-22 | 代码位置从 `v1/` 更正为 `src/` | PR #410 的教训：代码必须写在当前主代码目录下 |
| 2026-06-22 | 补充边界场景 B8、B9 及对应前置条件 | 架构师-2 审视发现遗漏：Issue 已完成时操作拒绝、阶段已完成时 completeStage 拒绝 |
| 2026-06-22 | 补充决策记录 D7、D8 | 架构师-2 审视提出：终端阶段判定校验、并发操作处理 |
| 2026-06-22 | 更新验证章节，拆分为 P1/P2/P3 | 补充边界情况测试和回归验证 |
