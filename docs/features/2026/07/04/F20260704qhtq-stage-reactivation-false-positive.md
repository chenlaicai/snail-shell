---
id: F20260704qhtq
title: stage-reactivation-false-positive
tags: [issue-collaboration, stage, bugfix]
---

# F20260704qhtq — 正向推进被误判为反向重新激活

## 元信息

- **Issue**: 第一次进入开发阶段，系统消息里写着《阶段 development 被重新激活。 打回来源：design 阶段 打回原因：xxx》
- **Issue ID**: 35aa724d-0272-4f61-9c1e-620e4abe7bae
- **创建日期**: 2026-07-04
- **影响范围**: collaboration.ts advanceStage / forceAdvance 的 kickoff 消息路径
- **兼容性**: 无不兼容更新

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 用户意图锚

| # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|---|---------|------|-----------|-----------|
| UA-1 | "第一次进入开发阶段，系统消息里写着《阶段 development 被重新激活。 打回来源：design 阶段 打回原因：xxx》这啥呀。语义奇奇怪怪的" | message #1 | 空间：无；时序："第一次"进入；数量：无；条件：正向推进时不应出现"重新激活"；视觉属性：无 | 用户报告正向推进（design→development）被误判为反向重新激活，导致 kickoff 消息语义错误。"第一次"强调这不是回退场景。 |

## 问题陈述

### 现象

design → development 正向推进时，系统发送的 kickoff 消息为：
```
阶段 development 被重新激活。
打回来源：design 阶段
打回原因：xxx
下游发现的问题：...
请针对以上问题修复后重新推进。
```

用户期望首次进入 development 时看到的是"开始执行。"或类似的正向 kickoff 消息。

### 根因分析

**直接原因**：`isBackwardTarget` 在 `advanceStage` 创建新 stage 之后才执行，导致新创建的 stage 被误判为"已存在的可重新激活的 stage"。

**代码路径**（collaboration.ts:159-173）：
```
advanceStage(stageId, targetKey):
  1. oldStage = findStage(stageId)                    // 获取当前 stage（如 design）
  2. stage = stagePort.advanceStage(stageId, targetKey)  // 创建新 stage（如 development）
  3. isBackward = isBackwardTarget(issueId, targetKey)   // 检查是否反向 — 此时新 stage 已存在！
  4. if (isBackward) autoInvokeBackwardStage(...)          // 发送"被重新激活"消息
     else autoInvokeNewStage(stage)                       // 发送"开始执行"消息
```

**`isBackwardTarget` 逻辑**（collaboration.ts:219-222）：
```typescript
private isBackwardTarget(issueId: string, targetKey: string): boolean {
    const stages = this.deps.stagePort.listStages(issueId) ?? [];
    return stages.some(s => s.key === targetKey && !s.left_at);
}
```

步骤 2 执行后，新创建的 development stage 满足 `key === "development" && !left_at`（刚创建，尚未离开），所以 `isBackwardTarget` 返回 `true`。**每一次正向推进都会被误判为反向重新激活。**

`forceAdvance` 方法（collaboration.ts:205）存在相同的时序缺陷。

### 为什么测试没有发现

测试使用静态 mock，`listStages` 返回值在 `advanceStage` 调用前后不变。mock 不会模拟"新 stage 被创建后 listStages 结果变化"这一行为，因此测试中 `isBackwardTarget` 的行为与生产环境不一致。

### 更深层问题：F20260703jh7v 部分实现

Feature F20260703jh7v 设计了完整的 `transferStage` 统一 API，包含：
- `StageStatus` 类型（`"active" | "rolled_back"`）
- `Stage.status` 字段
- `transferStage` 方法（正向创建新 stage，反向重新激活已有 stage）
- `rolled_back` 状态标记中间 stage

**实际代码中以上内容均不存在**：
- `transferStage` — 源码中无此方法
- `StageStatus` — model.ts 中无此类型
- `Stage.status` — model.ts 中无此字段
- `rolled_back` — 源码中无此状态

F20260703jh7v 的实现状态表标记为 ✅ 的项目实际上未实现。只有 `isBackwardTarget` 和 `autoInvokeBackwardStage` 被实现了，但它们依赖的底层基础设施（`transferStage`、`rolled_back`）缺失。

## 设计方案

### 修复策略：时序修正 + 接口对齐

#### B1: 将 isBackwardTarget 检查移到 advanceStage 之前

**当前**（错误）：
```
advanceStage → 创建新 stage → isBackwardTarget（找到新 stage → 误判）
```

**修正后**：
```
isBackwardTarget（只查找已有 stage） → advanceStage → 根据预判结果选择 kickoff 消息
```

在 `advanceStage` 和 `forceAdvance` 中，将 `isBackwardTarget` 调用移到 `stagePort.advanceStage` 之前。此时 `listStages` 返回的列表中不包含即将创建的新 stage，`isBackwardTarget` 只能找到真正已存在且未离开的 stage。

#### 预期行为（修正后）

时序修正后，`isBackwardTarget` 在 `advanceStage` 之前调用。由于当前 append-only 模型下已离开的 stage 必有 `left_at`，`isBackwardTarget` 对**所有**转移（正向和反向）都返回 `false`。实际方向判断由 `autoInvokeNewStage` 中的 `isStageReEntry` 承担：

- 首次 design → development：`isBackwardTarget` 返回 `false` → `autoInvokeNewStage` → `isStageReEntry` 返回 `false`（development 不在历史中）→ "开始执行。"
- 反向 review → development（development 已在历史中但已离开）：`isBackwardTarget` 返回 `false` → `autoInvokeNewStage` → `isStageReEntry` 返回 `true`（stage chain 中存在同 key 的更早实例）→ "重新进入 [development] 阶段。请先了解前序阶段的情况和变更，再开始工作。"

**降级说明**：反向转移的 kickoff 消息从"被重新激活 + 打回原因 + 下游问题"降级为"重新进入"。丧失了打回原因和证据传递，但消息语义正确（不再出现"被重新激活"的误判）。完整反向转移检测依赖 F20260703jh7v 的 `transferStage` 实现。

**影响范围**：
- `collaboration.ts advanceStage`（line 169）：检查移到 line 163 之前
- `collaboration.ts forceAdvance`（line 205）：检查移到 line 188 之前

#### B2: 补充测试覆盖 — 模拟真实 append-only 行为

现有测试的 mock 不会在 `advanceStage` 调用后更新 `listStages` 返回值，且 backward 测试使用 `left_at: null` 的 stage（在生产中不可能：已离开的 stage 必有 `left_at`）。需要增加测试：
- 正向推进场景：`advanceStage` 前后 `listStages` 返回值不同（新 stage 被加入），验证 kickoff 消息为"开始执行"
- 反向推进场景：目标 stage 已在历史中且 `left_at` 已设置，验证 kickoff 消息为"重新进入"（非"被重新激活"）
- 现有 backward 测试需标注：场景在生产中不可能（`left_at: null` 的已离开 stage），或重构为模拟真实 append-only 行为

#### 遗留问题记录：F20260703jh7v 未完成项

以下 F20260703jh7v 设计的内容仍未实现，不在本 issue 修复范围内：
1. `transferStage` 统一 API — 正向/反向转移的统一入口
2. `StageStatus` / `rolled_back` — 反向转移时标记中间 stage
3. 反向转移重新激活已有 stage（当前反向转移仍创建新 stage）
4. **`isBackwardTarget` 逻辑失效** — `!s.left_at` 条件为 `transferStage` 设计（反向转移时清除 `left_at` 重新激活），在 append-only 模型下已离开的 stage 必有 `left_at`，条件永远为 false
5. **`autoInvokeBackwardStage` 和 `extractBackwardContext` 变为死代码** — 时序修正后 `isBackwardTarget` 永远返回 false，这两个方法永远不会被调用
6. **反向转移打回原因/证据传递丧失** — 降级为"重新进入"消息，无打回原因和下游问题证据

这些遗留项意味着完整反向转移功能依赖 F20260703jh7v 的 `transferStage` 实现。应作为单独 issue 跟进。

## 行为条目

| # | 行为 | 预期 | 追溯 |
|---|------|------|------|
| B-1 | 首次正向推进到目标 stage | kickoff 消息为"开始执行。" | ← UA-1 |
| B-2 | 反向推进到已在历史中的 stage（append-only 模型，目标已离开） | kickoff 消息为"重新进入 [key] 阶段。请先了解前序阶段的情况和变更，再开始工作。"（来自 `autoInvokeNewStage` 的 `isStageReEntry` 路径） | ← UA-1 |
| B-3 | forceAdvance 路径 | 与 advanceStage 一致的 kickoff 消息 | ← UA-1 |

## 验收标准

1. design → development 首次推进时，kickoff 消息包含"开始执行"，不包含"被重新激活"
2. review → development 反向推进时（development stage 已在历史中且已离开），kickoff 消息包含"重新进入"，不包含"被重新激活"
3. forceAdvance 路径行为与 advanceStage 一致
4. 新增测试覆盖：mock `listStages` 在 `advanceStage` 调用后返回新 stage，验证正向推进不被误判
5. 现有 backward 测试标注或重构：`left_at: null` 的已离开 stage 场景在生产中不可能

<!-- [design-time] 章节结束 -->

## 实现指引

- `isBackwardTarget` 调用时机从 `stagePort.advanceStage` 之后移到之前
- `advanceStage` 和 `forceAdvance` 两个方法都需要修改
- `isBackwardTarget` 本身逻辑不变，只改调用位置
- `extractBackwardContext` 已经在 `advanceStage` 之前调用，不受影响
- `autoInvokeBackwardStage` 和 `extractBackwardContext` 在时序修正后变为死代码（`isBackwardTarget` 永远返回 false），保留不删除，待 `transferStage` 实现时激活
- 现有 backward 测试（`backward-signal-e2e.test.ts`、`force-advance.test.ts`）使用 `left_at: null` 的已离开 stage，此场景在生产中不可能，需标注或重构

## 设计决策记录

### 决策 1：时序修正而非完整实现 transferStage

**决策**：本 issue 只做 B1 时序修正，不完整实现 F20260703jh7v 的 `transferStage` API。

**正方**：用户报告的是 kickoff 消息语义错误，时序修正直接解决。`transferStage` 涉及 model 变更（新增 status 字段）、repository 变更、adapter 变更，范围远大于本 issue。反向转移有 `isStageReEntry` → "重新进入"作为降级行为，消息语义正确。

**反方**：时序修正同时禁用了反向转移检测。`isBackwardTarget` 的 `!s.left_at` 条件为 `transferStage` 设计（反向转移时清除 `left_at` 重新激活），在 append-only 模型下已离开的 stage 必有 `left_at`，条件永远为 false。`autoInvokeBackwardStage` 和 `extractBackwardContext` 变为死代码。反向转移丧失打回原因/证据传递，用户体验降级。

**结论**：降级可接受（"重新进入"消息语义正确，不是错误消息）。完整反向转移检测依赖 F20260703jh7v 的 `transferStage` 实现，应作为单独 issue 跟进。死代码保留不删除，待 `transferStage` 实现时激活。

### 决策 2：isBackwardTarget 逻辑不变但标注失效

**决策**：`isBackwardTarget` 的判断逻辑（`s.key === targetKey && !s.left_at`）保持不变，只调整调用时机。

**理由**：逻辑本身是为 `transferStage` 设计的（反向转移清除 `left_at` 后检查 `!s.left_at`）。在 append-only 模型下此条件对已离开的 stage 永远为 false，但这是底层模型缺失（`transferStage` 未实现）的后果，不是逻辑错误。将检查移到创建之前，消除正向推进的误判；反向检测的失效由遗留问题清单记录。

## 不兼容更新

无。
