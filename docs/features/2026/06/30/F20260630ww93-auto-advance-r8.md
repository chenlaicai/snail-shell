---
id: F20260630ww93
title: auto-advance-r8-finding-resolution-check
from_ids: [F20260630u38q]
tags: [bugfix, auto-advance, review-stage, adversarial-artifact]
modules: [issue-collaboration, auto-advance]
doc_kind: spec
---

# F20260630ww93 [bugfix] AutoAdvance R7 语义修正 + R8 findings 解决状态校验

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

review 阶段存在 6 个待处理问题（3 高 + 1 中 + 2 低），系统仍然建议推进到 merge。

根因：`AutoAdvanceEngine` 只验证对抗产物的**结构完整性**（R1-R5），不验证 `adversarial_findings` 中每条 finding 的 **`disposition` 是否为已解决状态**。审查者只要填满结构字段，即使 disposition 为 `"none"`（未处理），engine 也会放行。

这是 F20260630u38q（修复架构师审视"不阻塞"逃逸口）的延续：u38q 堵死了 design 阶段的逃逸口，但 review 阶段的引擎层校验仍有漏洞——流程说了"零漏洞"，引擎没有把"零漏洞"变成可验证的阻断条件。

## 目标

**P1 — 堵死 review 阶段 findings 未解决就推进 merge 的漏洞**

在 `AutoAdvanceEngine` 中增加 R8 规则：当 `adversarial_findings` 中存在 `disposition` 为 `"none"` 或空的 finding 时，阻断自动推进。

**P2 — 修正 R7 语义缺陷**

R7 条件 `f.finding === "no issues" || f.disposition === "none"` 将"未处理"等同于"无问题"，语义错误。修正为仅 `f.finding === "no issues"`，使 R7/R8 职责零交叉。

## 非目标

- 不修改 design 阶段的校验逻辑（design 阶段的 findings 结构不同，不适用 disposition 检查）
- 不修改流程规则（`adversarial-check.md` 已规定"处置方式只允许填在当前 PR 修复"）
- 不改变 `disposition` 字段的类型（仍为自由文本 string，不做 enum 约束）

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当 review 阶段的 `adversarial_findings` 中存在 `disposition: "none"` 的 finding 时 | engine 阻断自动推进，返回 `ADVERSARIAL_VALIDATION_FAILED`（规则 R8），message 说明哪个 speaker 有未解决的 finding 及数量 |
| B2 | 当 review 阶段的 `adversarial_findings` 中存在 `disposition` 为空字符串的 finding 时 | 同 B1，视为未解决 |
| B3 | 当 `adversarial_findings` 中每条 finding 的 `disposition` 均不为 `"none"` 且非空时 | R8 通过，不阻断 |
| B4 | 当 finding 的 `finding` 为 `"no issues"` 时 | 无论 `disposition` 为何值，该条不触发 R8（"无问题"不需要 disposition） |
| B5 | 当 `disposition` 为新引入的 `"withdrawn"` 时 | 视为已解决（审查者在复检中确认该 finding 为误报，主动撤回） |
| B6 | 当 adversarial_findings 为空数组时 | R1 已阻断（`adversarial_findings must not be empty`），R8 不额外处理 |
| B7 | 当所有 finding 的 `finding` 均为 `"no issues"` 时 | R7 告警（allClear=true），R8 不阻断——这是唯一触发 R7 的场景 |
| B8 | 当 R7 和 R8 同时满足触发条件时（所有 finding 都是 `disposition: "none"` 且 `finding !== "no issues"`） | R8 阻断优先，R7 不执行——R7 的 allClear 检查在 R8 return 之后，不可达 |

## 设计

### R8 规则定义

| 属性 | 值 |
|------|---|
| 规则 ID | R8 |
| 检查阶段 | review（`stage.key === "review"`） |
| 阻断类型 | 阻断（与 R1-R5 同级） |
| 错误码 | `ADVERSARIAL_VALIDATION_FAILED`（复用现有错误码，details 中标注 rule: "R8"） |
| 检查逻辑 | 对每条 finding：若 `finding !== "no issues"` 且 (`disposition === "none"` 或 `disposition.trim() === ""`)，则该条未解决 |

### R7 语义修正

R7 原有条件 `f.finding === "no issues" || f.disposition === "none"` 存在语义错误：将 `disposition: "none"`（未处理）等同于 `"no issues"`（无问题）。修正为仅检查 `finding === "no issues"`。

```
修正前：f.finding === "no issues" || f.disposition === "none"
修正后：f.finding === "no issues"
```

**理由**：`disposition: "none"` 的语义是"有问题但未处理"，不应触发"全部无问题"告警。R7 的职责是检测可疑的"全部无问题"模式，只有 `finding === "no issues"` 才能表达此语义。

### 与 R7 的关系（零交叉）

R7 和 R8 检查不同字段，职责正交：

| 规则 | 检查字段 | 触发条件 | 行为 |
|------|---------|---------|------|
| R7 | `finding` only | 所有 finding 的 `finding === "no issues"` | 告警（不阻断） |
| R8 | `finding` + `disposition` | 任一 finding 的 `finding !== "no issues"` 且 `disposition` 为空/"none" | **阻断** |

R7 不再触及 disposition，R8 不再关心"全部无问题"。两个规则零交叉，无交互，无优先级冲突。

### `disposition` 取值约定

在 `adversarial-artifact-protocol.md` 中明确 disposition 的取值语义：

| 值 | 含义 | R8 行为 |
|----|------|---------|
| `"在当前 PR 修复"` | 开发者已修复，审查者已确认 | 通过 |
| `"withdrawn"` | 审查者在复检中确认为误报，主动撤回 | 通过 |
| `"none"` | 未处理 | **阻断** |
| `""` (空字符串) | 未填写 | **阻断** |
| 其他非空字符串 | 自定义处置（向前兼容） | 通过 |

选择黑名单（只阻断 `"none"` 和空）而非白名单（只放行特定值）的理由：
- 向后兼容：现有对抗产物中 disposition 值多样（如 `"在当前 PR 修复"`、`"fixed"`、`"resolved"`），白名单需要枚举所有历史值
- 语义清晰：只阻断明确的"未处理"状态，其他值默认通过

### 关键决策：R7 修正 + R8 新增

| 方案 | 优点 | 缺点 |
|------|------|------|
| 只新增 R8，保留 R7 原有条件 | 改动最小 | R7 的 `disposition: "none"` 条件语义错误（将"未处理"等同于"无问题"），虽被 R8 覆盖但保留了错误语义 |
| 只修正 R7，不新增 R8 | 规则数量不增加 | R7 是 warning 级别，改为阻断需要改 severity，语义从"告警可疑模式"变成"阻断未解决"，职责混淆 |
| R7 修正 + R8 新增（选择的方案） | R7 语义正确（只检查 finding），R8 职责单一（阻断未解决），零交叉 | 多一条规则 + 修改现有规则 |

### 实现指引

**问题 1**：`auto-advance.ts` 的 `validateAdversarialArtifact` 方法中 R7 条件 `f.finding === "no issues" || f.disposition === "none"` 语义错误，将"未处理"等同于"无问题"。

**预期方向**：R7 条件收紧为仅 `f.finding === "no issues"`。

**问题 2**：`validateAdversarialArtifact` 在 R7 之后返回 `{ valid: true, allClear }`，不检查每条 finding 的 disposition 状态。

**预期方向**：在 R7 检查之前增加 R8 检查。对 `adversarial_findings` 中每条 finding，若 `finding !== "no issues"` 且 `disposition` 为 `"none"` 或空，则返回 `{ valid: false, reason: "...", rule: "R8" }`。

**关键约束**：
- R7 修正只改变 allClear 的触发条件，不改变其 warning 行为
- R8 只在 `stage.key === "review"` 时生效（design 阶段的 findings 不适用 disposition 检查）
- 复用现有 `ADVERSARIAL_VALIDATION_FAILED` 错误码，不新增错误码
- R8 的 `reason` 必须包含未解决 finding 的数量，便于前端展示
- R8 阻断时，R7 的 allClear 检查不再执行（已阻断无需告警）
- R7 和 R8 检查不同字段（finding vs finding+disposition），零交叉

### 改动范围

| 文件 | 变更类型 |
|------|----------|
| `src/app/issue-collaboration/auto-advance.ts` | R7 条件收紧（去除 `disposition === "none"`）+ R8 新增（含精确错误消息） |
| `data/file/skills/cd-shared/references/adversarial-artifact-protocol.md` | R8 规则说明 + disposition 取值约定 |
| `tests/auto-advance.test.ts` | R7 收紧测试 + R8 全场景测试 |

## 设计约束摘要

- **边界**：不修改流程规则文件（adversarial-check.md），不修改前端组件，不修改 design 阶段校验
- **关键决策**：R7 语义修正（去除 disposition 混淆）+ R8 新增（阻断未解决），职责零交叉；采用黑名单（只阻断 none/空）而非白名单（只放行特定值）
- **向后兼容**：现有合规的对抗产物（disposition 为非空非 "none"）不受影响；R7 收紧仅影响 allClear 告警触发条件，不改变阻断行为
- **语义不变量**：adversarial_findings 中每条有实际发现的 finding，disposition 必须为已解决状态，否则阻断自动推进；R7 只关心 finding 是否为"无问题"，不触及 disposition

## 关联

| 关系 | Feature | 说明 |
|------|---------|------|
| 前置 | F20260630u38q | 修复架构师审视"不阻塞"逃逸口——本 feature 是其在引擎层的延续 |

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | R8 独立于 R7 | R8 职责单一（阻断未解决），R7 职责单一（告警全无问题），语义不同不应混合 | 多一条规则增加理解成本 | 新增 R8 独立规则 | R7 检查"全无问题"是可疑模式（告警），R8 检查"有未解决"是硬性阻断，severity 和职责均不同 | 架构师-1 | 2026-06-30 |
| D2 | "白名单阻断" vs "白名单放行" | 白名单放行更安全，不会遗漏 | 白名单放行需要枚举所有历史 disposition 值，破坏向后兼容 | 白名单阻断 | 向后兼容：现有合规产物不受影响；黑名单只阻断明确的"未处理"状态 | 架构师-1 | 2026-06-30 |
| D3 | R8 是否适用于 design 阶段 | design 阶段也可以有 findings | design 阶段 findings 的 disposition 语义不同（不是"修复"而是"写入文档"） | 仅 review 阶段 | review 阶段有明确的"修复→复检"闭环，design 阶段没有 | 架构师-1 | 2026-06-30 |
| D4 | R7 是否修正 `disposition === "none"` 条件 | R7 语义错误（将"未处理"等同于"无问题"），修正后 R7/R8 零交叉 | R8 已覆盖该场景，修正 R7 是额外改动 | 修正 R7 | 错误语义不应保留——即使被 R8 覆盖，也是定时炸弹（未来修改 R8 时可能重新暴露）；R7/R8 零交叉消除交互复杂度 | 架构师-2 | 2026-06-30 |

<!-- [design-time] 章节结束 -->

## 验证

- [x] R8 测试用例覆盖：disposition 为 "none" 阻断、空字符串阻断、"withdrawn" 通过、"在当前 PR 修复" 通过、"no issues" 跳过
- [x] R7 收紧测试：所有 finding 为 "no issues" 时 allClear=true；混合 "no issues" + "在当前 PR 修复" 时 allClear=false
- [x] R7/R8 交互测试：所有 finding 为 `disposition: "none"` 时 R8 阻断（R7 不可达）
- [x] 现有测试不受影响（回归）— 103/103 通过
- [x] R7 告警行为不变（仍为 warning，不阻断）
