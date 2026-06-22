---
id: F2026062206
title: issue-status-improvement
from_ids: []
tags: []
modules: []
doc_kind: spec
---

# F2026062206 [issue] Issue 状态完善

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 Issue 生命周期存在三个相互关联的问题：

1. **`merge` 阶段完成后 Issue 无终态**：`merge` 是 code-delivery SOP 的最后阶段。当 `merge` 完成（`left_at` 被设置）后，`currentStage.status` 变为 `"completed"`，但 Issue 本身没有任何标记。`closed_at` 字段存在但**没有任何代码路径会设置它**。Issue 在看板上显示为 "Done"，但这只是从 `current_stage.status` 推导的，不是 Issue 级别的状态。

2. **终端阶段的 "Advance Stage" 语义错误**：在 `merge` 阶段**进行中**时，`StageActionBar` 显示的可用转换只有 `merge -> review`（打回路径）。按钮文案是 "Advance Stage"，但从业务语义上这是**回滚**。

3. **单阶段 SOP 的终态问题**：`evolution`（单 `development` 阶段）和 `general-assistant`（单 `chat` 阶段）没有定义任何 transitions。这些阶段完成后，Issue 同样无法标记为完成。

**根因**：当前架构有一个根本性的缺口——stage 推进机制（`advanceStage`）和 Issue 完成机制是两件不同的事，但后者从未实现。

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
| B1 | 当 Issue 的当前阶段是终端阶段（`available_transitions` 中无正向转换）且阶段仍进行中时 | StageActionBar 显示 "Complete Stage" 按钮（主操作），如果有反向转换则同时显示 "Bounce to X" 次要按钮 | v1/tests/workspace/stage-cycle-test.ts::completeStage 测试 |
| B2 | 当终端阶段已完成（`left_at` 已设置）且 `closed_at` 为 null 时 | StageActionBar 显示 "Complete Issue" 按钮 | v1/tests/workspace/stage-cycle-test.ts::completeStage 测试 |
| B3 | 当阶段有正向转换时 | 显示 "Advance to X" 按钮 | v1/tests/workspace/stage-cycle-test.ts::advanceIssue 测试 |
| B4 | 当阶段只有反向转换时 | 显示 "Bounce to X" 按钮 | v1/tests/workspace/stage-cycle-test.ts::transitionIssueStage 测试 |
| B5 | 当阶段正反向转换都有时 | 显示两个选项，默认正向 | v1/tests/workspace/stage-cycle-test.ts::advanceIssue 测试 |
| B6 | 当 Issue 已完成（`closed_at` 非空）时 | StageActionBar 不显示，所有阶段只读 | v1/tests/workspace/stage-cycle-test.ts::archived issue 测试 |
| B7 | 当 SOP 只有一个阶段且无任何转换时 | 阶段进行中显示 "Complete Stage"，完成后显示 "Complete Issue" | v1/tests/workspace/stage-cycle-test.ts::terminal SOP 测试 |
| B8 | 当判断阶段是否为终端阶段时 | 使用 `sop_snapshot.stage_definitions` 数组索引判断：`available_transitions` 中不存在 `targetIndex > currentIndex` 的转换 | v1/tests/workspace/stage-cycle-test.ts::completeStage 测试 |

## 设计

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

**前置条件**：
- 当前阶段的 `available_transitions` 中不存在正向转换
- 当前阶段的 `left_at` 为 null（阶段进行中）

**与 advanceStage 的区别**：
- `advanceStage`：从当前阶段转移到目标阶段（创建新阶段）
- `completeStage`：标记终端阶段完成（不创建新阶段）

### completeIssue 操作

**行为**：
- 设置 `closed_at` 为当前时间
- 不修改任何阶段状态

**前置条件**：
- 当前阶段的 `left_at` 已设置（阶段已完成）
- `closed_at` 为 null

**独立性**：`completeIssue` 是独立于 `advanceStage` 和 `completeStage` 的操作，专门用于 Issue 生命周期管理。

### StageActionBar 交互

**终端阶段进行中**：
- 主按钮："Complete Stage"（调用 `completeStage`）
- 次要按钮：如果有反向转换，显示 "Bounce to X"（调用 `advanceStage`）
- 不使用下拉选择器，两个选项直接展示

**终端阶段已完成**：
- 按钮："Complete Issue"（调用 `completeIssue`）

**非终端阶段**：
- 保持现有行为："Advance to X" 或下拉选择器

**Issue 已完成**：
- StageActionBar 不显示（`issue.closed_at` 非空）

### 看板状态

Issue 状态推导逻辑：
- `closed_at` 非空 → Issue 状态为 "completed"
- `closed_at` 为 null → Issue 状态由 `current_stage.status` 推导（现有逻辑）

## 生效路径

本 feature 的规则通过以下入口生效：
1. **代码**：`completeStage` 和 `completeIssue` 的 API 端点和业务逻辑
2. **前端**：`StageActionBar` 组件的按钮文案和交互逻辑
3. **看板**：`issue-utils` 中的状态推导逻辑

## 设计约束摘要

- **边界**：
  - `completeStage` 仅适用于终端阶段（无正向转换）
  - `completeIssue` 仅在终端阶段完成后可用
  - 不实现 reopen，`closed_at` 一旦设置不可撤销（本次 scope）

- **关键决策**：
  - Issue 完成是独立操作（`completeIssue`），不嵌入 `advanceStage`
  - 正向/反向判断用数组索引，不引入 `sequence` 字段
  - 终端阶段 UI 同时显示 "Complete Stage" 和反向转换（如有）

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
- 终端阶段进行中显示 "Complete Stage" 按钮
- 终端阶段已完成显示 "Complete Issue" 按钮
- `completeStage` 正确设置 `left_at`
- `completeIssue` 正确设置 `closed_at`
- 单阶段 SOP（evolution、general-assistant）支持完成
- 看板状态正确反映 Issue 完成状态
- 现有 `advanceStage` 行为不受影响

<!-- [design-time] 章节结束 -->

## 改动范围

| 层 | 变更 |
|---|------|
| SOP Snapshot Reader | 新增 `isForwardTransition` 和 `isTerminalStage` 方法；`getForwardTransitions` 重命名为 `getOutgoingTransitions`（名称歧义修正） |
| Workflow | 新增 `completeStage` 函数 |
| Manager | 新增 `completeStage` 方法，修改 `completeIssue` 方法添加阶段检查 |
| API route | 新增 `POST /issues/:issueId/complete-stage` endpoint |
| Prompt Center | `registry.ts` 和 `platform-paths.ts` 修复 `process.cwd()` → `__dirname` 路径解析（prompt 模板在非 v1 根目录运行时无法加载的 bug） |
| Frontend: StageActionBar | 区分正向/反向/终端状态，显示不同按钮和文案（**拆分至后续 PR**） |
| Frontend: issue-utils | Issue 状态推导需考虑 `closed_at`（**拆分至后续 PR**） |
| Frontend: IssueConversation | 完成状态的 UI 表现（**拆分至后续 PR**） |

## 验证

### P1
- [ ] 终端阶段进行中显示 "Complete Stage" 按钮
- [ ] 终端阶段已完成显示 "Complete Issue" 按钮
- [ ] `completeStage` 正确设置 `left_at`
- [ ] `completeIssue` 正确设置 `closed_at`

### P2
- [ ] 非终端阶段保持现有 "Advance to X" 行为
- [ ] 反向转换显示为 "Bounce to X"
- [ ] Issue 已完成时 StageActionBar 不显示

### 通用
- [ ] 单阶段 SOP（evolution、general-assistant）支持完成
- [ ] 看板状态正确反映 Issue 完成状态
- [ ] 现有 `advanceStage` 行为不受影响

## 关联

无前置或阻塞依赖。

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | Issue 完成是独立操作还是 stage 推进的副作用？ | 独立操作语义清晰；适用于所有 SOP（包括单阶段）；与 `closed_at` 字段直接对应 | 需要新增 API 端点 | 独立的 `completeIssue` 操作 | 语义清晰，与现有字段对应，适用于所有 SOP | 架构师-1, 架构师-2 | 2026-06-22 |
| D2 | 如何区分正向和反向转换？ | 用 `stage_definitions` 数组索引：不需要改 domain model，不需要改解析逻辑 | 用 SOP YAML 显式标记 `direction`：更精确但增加配置负担 | 用数组索引判断 | 更简单，不需要改 domain model | 架构师-1, 架构师-2 | 2026-06-22 |
| D3 | 终端阶段进行中时是否允许直接完成 Issue？ | 允许可以减少操作步骤 | 两步操作分离质量保障（stage gate）和生命周期管理（issue completion）；如果允许跳过 gate，gate 机制形同虚设 | 阶段必须先完成才能完成 Issue | 分离关注点，保持 gate 机制有效性 | 架构师-1, 架构师-2 | 2026-06-22 |
| D4 | `completeStage` 适用范围 | 仅终端阶段：语义清晰，与 `advanceStage` 分工明确 | 所有阶段都可以调用：更灵活但可能破坏流程完整性 | 仅终端阶段（无正向转换） | 保持语义清晰，防止中间阶段被跳过 | 架构师-1, 架构师-2 | 2026-06-22 |
| D5 | 终端阶段进行中时是否隐藏反向转换？ | 隐藏可以简化 UI，避免用户误点 | `merge` 阶段打回是真实业务场景（如 CI 发现问题）；隐藏会迫使用户先完成 stage 再 bounce，多了无意义的一步 | 同时显示 "Complete Stage" 和反向转换（如有） | 支持真实业务场景，用户意图由按钮文案决定 | 架构师-1, 架构师-2 | 2026-06-22 |
| D6 | 是否在本次 scope 中实现 reopen？ | 对称操作一起做更完整 | reopen 是独立的生命周期特性，聚焦核心需求；`closed_at` 基础设施已就位，未来可独立实现 | 排除出本次 scope | 聚焦核心需求，降低复杂度 | 架构师-1, 架构师-2 | 2026-06-22 |

## 范围变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-06-22 | 前端变更（StageActionBar、issue-utils、IssueConversation）拆分至后续 PR | 后端逻辑独立可交付，前端依赖 UI 设计稿，拆分降低 PR 复杂度 |
