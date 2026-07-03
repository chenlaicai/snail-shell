# Intake 审视 Protocol

## 概述

Intake 审视是 agent 进入阶段后的第一个动作，在开始正常工作之前执行。目标是评估上游产物是否足以支撑本阶段工作，决定是继续还是打回。

## 设计原则

- Intake 审视是 **protocol step**，不是 gate。Gate 是"离开前检查"，intake 是"进入后检查"。
- 时间点相反：gate 在工作完成后执行，intake 在工作开始前执行。
- 产出独立的早期信号，与后续的 gate_complete / adversarial_consensus 信号互斥。

## 执行流程

```
agent 进入阶段
  → 加载上游产物
  → 按本阶段 intake 问题清单评估
  → 结论："不足" + 存在上游 stage → 发出 stage_transition 信号（target_key 指向上游）
  → 结论："不足" + 无上游 stage（首阶段）→ 路由到 user 请求补充信息
  → 结论："足够" → 继续正常工作
```

## 各阶段 Intake 问题清单

### design 阶段（评估 issue 描述）

1. issue 描述是否包含足够的上下文让我理解"要解决什么问题"？
2. 描述中是否有自相矛盾或模糊到无法消歧的约束？
3. 基于这个描述开始设计，最大的风险是什么？

**判断标准**：
- 第 1 或第 2 题答案为"否"，且第 3 题风险是根本性的 → 作为首阶段，路由到 user 请求补充信息
- 否则 → 继续正常工作

**注意**：design 是首阶段，没有上游 stage 可打回。走 notification 路径，不发 stage_transition 信号。

### development 阶段（评估 feature 文档）

1. 行为规格是否明确到可以直接实现，而不需要猜测意图？
2. 是否存在技术上不可行或成本极高的设计约束？
3. 预期哪些地方需要做"文档没说但必须做"的决策？

**判断标准**：
- 第 1 或第 2 题答案为"否" → target_key 指向 design（打回到设计阶段）
- 否则 → 继续正常工作

### review 阶段（评估 PR）

1. PR 的整体架构方向是否忠实于 feature 文档的设计意图？
2. PR 是否引入了 feature 文档未提及的重大架构变更？
3. 如果存在方向偏差，这是设计文档的问题还是实现的问题？

**判断标准**：
- 偏差是设计问题 → target_key 指向 design
- 偏差是实现问题 → review 阶段内解决，不打回
- 无偏差 → 继续正常工作

## 信号互斥规则

- 如果当前阶段已有方向不同的信号 → 触发 disagreement（不静默拒绝）
- 如果 agent 已发出早期 sendback 信号，后续的正向信号被拒绝
- 如果 agent 已发出正向信号，后续的 sendback 信号被拒绝
- 互斥检查在 `detectStageTransition` 中执行

## 信号格式

Intake 审视产出的信号与正常 stage_transition 信号格式相同，只是时间点更早：

```json
{
  "stage_transition": {
    "signal_type": "gate_complete",
    "target_key": "design",
    "reason": "Feature 文档存在根本性缺陷，无法基于此实现",
    "guard": "intake: 行为规格不明确",
    "gate_evidence": {
      "intake-1": "文档未定义 X 的边界条件",
      "intake-2": "约束 Y 与约束 Z 矛盾"
    }
  }
}
```

**注意**：development 阶段的 intake 信号使用 `signal_type: "gate_complete"`（单 agent），但 `target_key` 可以指向 design（反向）。引擎统一处理。

## 首阶段的 Notification 路径

design 阶段没有上游 stage，`available_transitions` 不包含 `user` 或 `issue`。

处理方式：
1. agent 的 intake 审视结论为"上游输入不足"
2. 不发出 stage_transition 信号
3. 通过 `set_final_body` 的 `to_speakers` 路由到 user
4. 说明具体缺陷并请求补充信息
5. stage 状态变为 needs_human（等待用户输入）
6. 用户补充信息后，agent 重新执行 intake 审视

此处理方式通用于所有多阶段 SOP 的第一个阶段。
