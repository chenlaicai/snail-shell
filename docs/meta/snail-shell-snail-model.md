# Snail Shell Snail 模型

## 目的

本文档用于沉淀当前阶段已经拍板确定的 Snail Shell `snail` 概念模型。

这里的 `snail` 是 Snail Shell 工作室中的核心执行单元概念。

当前阶段已经明确：

Snail Shell 不再长期并列维护 `role` 和 `agent` 两套顶层概念，而是统一使用 `snail` 作为系统中的工作执行者与职责承载体概念。

## 为什么叫 snail

当前工作室本身就叫 Snail Shell。

因此，工作室中的执行单元自然统一命名为：

`snail`

这个命名有几个优点：

1. 和系统品牌一致
2. 不再额外引入抽象而生硬的术语
3. 比 `role` 更具体
4. 比单独使用 `agent` 更符合工作室语境

## Snail 的定位

在 Snail Shell 中，`snail` 表示：

`工作室中的一个执行单元`

它不是简单标签，也不是单纯底层模型 runtime 的代称。

它同时承载：

1. 工作职责定位
2. 能力要求
3. 工作方式要求
4. 在某个具体上下文中的执行身份

## 为什么不再并列保留 role 和 agent

当前阶段已经明确：

如果长期并列保留 `role` 和 `agent` 两套核心概念，系统会出现概念重叠：

1. 一边说职责语义
2. 一边说执行者
3. 实际上两者在当前系统中始终紧密绑定

这会导致文档、建模、实现上长期出现概念漂移。

因此当前阶段统一采用：

`snail`

来同时承载“职责 + 执行单元”这组概念。

## Snail 不是纯运行时对象

虽然 snail 最终会落到某个底层 agent runtime 上执行，但在系统建模中，snail 不是一个单纯的 runtime 句柄。

Snail 更接近于：

`工作室中的岗位化执行单元`

也就是说，一个 snail 的核心不是“它调用的是哪个模型”，而是：

- 它承担什么职责
- 它应满足哪些要求
- 它在当前 project / stage / conversation 中应如何工作

## Snail 的三层含义

当前阶段，`snail` 至少有三层含义：

### 1. 职责含义

snail 首先表示一种职责身份。

例如：

1. 需求分析 snail
2. 架构设计 snail
3. 软件实现 snail
4. 验收 snail

### 2. 要求含义

snail 同时表示一组要求集合。

例如：

- 这个 snail 应具备什么能力
- 这个 snail 应采用什么工作方式
- 这个 snail 应优先产出什么类型的 artifact

### 3. 执行含义

snail 最终会在具体工作中实际执行任务。

也就是说，在某次 conversation 中，一个 snail 不只是一个抽象名字，而是真正参与工作的执行单元。

## Snail 与系统模型的关系

Snail 不属于系统最外层模型。

系统最外层仍然是：

`Project -> Stage -> Conversation -> Artifact`

snail 是在这个结构中参与工作的执行单元。

更准确地说：

1. project 定义工作边界
2. stage 定义工作位置
3. conversation 定义工作过程
4. artifact 定义工作产物
5. snail 定义“谁以何种要求执行这次工作”

## Snail 与 Conversation 的关系

当前阶段，snail 的主要工作场景是 conversation。

也就是说：

1. 每条 conversation 会有一个主要 snail 身份
2. 这个 snail 决定该次工作过程的职责语义
3. conversation 中的工作要求会由 snail 叠加 system/project/stage/conversation 多层上下文共同决定

并且当前阶段已经明确：

snail 不是由用户在每次 conversation 中自由选择的。

相反，每一种 `stage.type` 都有固定参与 snail 集合，这组对应关系属于系统规范，并由：

`/.meta/stage-snails.json`

定义。

当前第一版运行时实现中，会先取该阶段固定参与 snail 列表中的第一个 snail，作为当前 conversation 的主 snail。

因此，当前 conversation 上使用的字段应为：

`snail_name`

## Snail 的内置要求

Snail 不是空白执行者。

每个 snail 都会绑定一组内置要求。

这些要求包括：

1. 职责范围
2. 能力预期
3. 工作方式要求
4. 输出要求
5. 与当前阶段的匹配方式

## 当前阶段的实现边界

当前阶段已经明确：

snail 将会是一个持续完善的模块，但第一版实现不追求完整 snail 体系，而先采用最小可用形态。

当前第一版可以简化为：

1. 系统内置一个基于 `claude` CLI 的 snail
2. 当前所有内置 snail 暂时统一使用该 runtime
3. 后续再逐步细化不同 snail 的能力模型与要求模型

也就是说：

当前阶段 `snail` 的设计语义已经成立，
但运行时实现先用一个最小内置 snail 落地。

例如：

### 需求分析 snail

应强调：

- 需求识别
- 需求结构化
- 范围收敛
- 问题澄清

### 架构设计 snail

应强调：

- 模块边界
- 结构设计
- 数据与接口建模
- 技术约束表达

### 软件实现 snail

应强调：

- 代码实现
- 改动可追溯
- 产物落地
- 与设计保持一致

## Snail 的多层级要求体系

当前阶段已经明确：

Snail 的要求不能是一大坨无结构 prompt，而应是分层叠加的。

至少包括以下几层：

### 1. Snail Shell 全局要求

例如：

- 工作必须留痕
- 产物必须可组织
- 工作必须归属于 project / stage / conversation 结构

### 2. Snail 自身要求

例如：

- 该 snail 的职责定义
- 该 snail 的工作方式要求
- 该 snail 的输出偏好

### 3. Project 层要求

例如：

- 当前 project 的目标
- 当前 project 的长期约束
- 当前 project 的设计原则

### 4. Stage 层要求

例如：

- 当前阶段应优先完成什么
- 当前阶段正式交付物是什么
- 当前阶段不应越界做什么

### 5. Conversation / Feature 层要求

例如：

- 当前 conversation 的具体目标
- 当前 feature 的局部约束
- 当前 conversation 对上游 conversation 的继承关系

## Snail 与 Prompt 的关系

Snail 的这些分层要求，最终会投影到底层 agent 的运行上下文中。

也就是说，Snail Shell 最终赋予底层执行者的 system prompt / context，本质上是：

`Snail Shell 全局要求 + snail 自身要求 + project 要求 + stage 要求 + conversation 要求`

但在系统设计上，Snail Shell 不把“prompt 文本本身”视为主模型对象，而把它理解为：

系统模型在执行层的一种展开形式。

## 当前明确放弃的方案

### 1. 长期并列保留 role 和 agent

放弃原因：

这会造成概念重叠，并使文档与实现长期存在双重语义。

### 2. 只把 snail 理解成底层模型 runtime

放弃原因：

这会把系统重心重新拉向运行时，而削弱工作职责与结构语义。

### 3. 把所有要求写成一整坨 prompt

放弃原因：

这会让不同层次的要求边界消失，不利于后续系统持续完善。

## 当前 snail 模型的一句话总结

Snail Shell 当前阶段的 `snail` 模型是：

`snail 是工作室中的执行单元，它同时承载职责、要求与执行身份，并在 project / stage / conversation 的上下文中参与工作。`
