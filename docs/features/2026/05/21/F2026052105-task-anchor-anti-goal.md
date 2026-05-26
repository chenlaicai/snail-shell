---
id: F2026052105
title: 任务锚机制：防 AI 表面修复的意图锚定系统
from_ids: []
tags: [prompt, workflow]
modules: [project_management]
---
# F2026052105 任务锚机制：防 AI 表面修复的意图锚定系统

## 背景

### 问题现象

AI 在解决 merge conflict、修复错误等操作中频繁出现"为了做而做"的问题——以"消除冲突标记""让错误消失""让 diff 看起来合理"等表面信号替代语义正确性作为完成标准。

**典型案例**：在"context 优化"任务中，AI 合并 rebase 时不理解移除 branchname 等三个字段是有意为之（intentional removal），而是直接改回老版本。冲突确实消失了，但语义被破坏了。

用生活类比：把车开进修理厂说"发动机灯亮了"，AI 技师把灯泡拔了说"修好了"——灯确实不亮了，但问题没解决。或者说"这菜太咸了"，AI 理解为"那就别放盐"——咸的问题确实消失了，但想要的并不是"无盐"，而是"合适的咸淡"。

### 根因：不是一个问题，是三个问题叠加

表面看是 AI "不够聪明"，但拆开来看是三个独立但互相放大的失败模式：

#### 失败模式 1：目标函数被替换（Goal Surrogation）

AI 在做每一步时，有一个隐式的"优化目标"。问题在于，**AI 的默认优化目标天然倾向于"可度量、即时、表面的成功"而非"不可度量、长期、语义的正确"**。

- 合并 rebase 时，AI 的隐式目标：让冲突消失、让代码能编译、让 diff 看起来"合理"——这些都是**可即时验证的**。
- 用户的真实目标：保留 intentional removal，因为 branchname 等三个字段已被确认移除——这需要理解"为什么移除"，是**语义判断**。

这不是 AI 不够聪明，而是 AI 的 RLHF 训练过程天然鼓励"解决问题的效率"而非"理解问题的深度"。人类反馈更倾向于奖励"快速给出看起来对的答案"而非"花时间问清楚再答"。

#### 失败模式 2：多轮对话中的注意力稀释（Attention Dilution）

SGLang 社区的研究给出了精确的量化数据：

> 系统提示词在对话开始时有 ~50% 的注意力权重，到 80K tokens 上下文时降到 ~1%。

这意味着，当对话中确立了"branchname 等字段已被移除"这个事实后，经过多轮交互，这个事实在 AI 注意力中的权重已经微乎其微。当 AI 面对 merge conflict 时，它看到的只是：

- 当前冲突：A 有字段，B 没有字段
- 就近的上下文：merge conflict markers
- **它看不到**：10 轮之前确认过的"这些字段应该被移除"

JetBrains 的研究称之为 **"Pattern Prison"（模式监狱）**——反复的 Tool call → Tool result 循环变成了一种隐式 few-shot 训练，让模型学会了"工具调用是唯一正确的行为"，从而压制了"我应该先确认目标"的行为。

另一项研究（2025 年 5 月）发现：多轮对话模式下模型成功率平均下降约 **39%**，错误率上升 **112%**。模型最怕"边说边改"，最爱"一次说清楚"。

#### 失败模式 3：Instruction Tuning 的系统性偏见——"永远生成点什么"

ClarifyCoder 论文（Wu et al., 2025）揭示了一个根本性事实：

> 当前的 Code LLM 在 **63% 的模糊场景下直接生成代码**，而不是请求澄清。原因是它们的 instruction-tuning 数据集**假设所有指令都是完整且明确的**。

模型被训练成"不管输入多模糊，都要给出一个输出"——从训练角度看，这比"说我不知道"或"让我确认一下"在 loss function 上更好。因为训练数据里几乎没有"我需要更多信息"的样本。

这就是"太咸了？那就不放盐"的根本原因——AI 不理解"合适的咸淡"这种抽象目标，但它必须输出一个方案，于是它猜了一个最浅显、最机械的答案。这在字面上完美解决了"咸"的问题。

### 因果链：三级放大

```
失败模式 3（训练偏差：永远要产出）
    ↓ 强化了
失败模式 2（注意力稀释：忘了最初的目标是什么）
    ↓ 导致了
失败模式 1（即时目标替换："解决冲突"替换了"保留正确的语义"）
    ↓ 产出
表面修复（把 intentional removal 改回去 = 冲突消失了 = "成功"）
```

三层各自独立存在，但在多轮 AI 编程交互中会**级联放大**。merge rebase 场景恰好击穿了所有三个薄弱点。

### 核心矛盾：两套"成功"定义的冲突

有一个更深层的问题值得指出：**AI 的"成功"定义和用户的"成功"定义之间存在结构性的不对称**。

- **AI 的"成功"**：这个操作完成了、没有报错、diff 看起来合理、测试通过了。
- **用户的"成功"**：保留了正确的语义、没有引入回归、符合设计意图。

当前的 AI 架构中，**"语义正确性"不是任何 loss function 的组成部分**。它只能通过外部约束（提示词规则、checklist、review gate）来间接逼近。

本 feature 处理的本质问题是：**当"解决表面问题"的路径比"理解深层意图"的路径短得多时，AI 会永远选择短路径**——这不是 bug，这是当前 AI 架构的 emergent property。解决方案不是让 AI "更聪明"，而是通过结构化约束（任务锚、反目标、场景细则）来拉长"表面修复"的路径，缩短"意图确认"的路径。

## 目标

- 引入"反目标"概念（什么绝对不能发生），作为通用原则层的 [STD] 规则
- 引入"任务锚"机制——结构化记录本质目标、反目标、语义不变量、成功标准，在系统提示词中以 [HARD] 区块持久注入，不被对话流稀释
- 将泛化的"不要猜测"规则具体化为三组场景细则（合并冲突解决、错误修复、字段变更），使 AI 有具体操作步骤可依
- 提供评估样本 PE008 以回归验证任务锚行为

## 非目标

- 不改变现有的 GATE 流程和阶段推进机制
- 不新增提示词模块（改动收敛在现有 B-01、S-03、S-01 和 developer-handbook 中）
- 不引入新的计划工具（EnterPlanMode 仍被 B-03 禁止）

## 设计

### 三层规则架构

```
B-01（通用原则层）
  ├─ 扩展"行动前识别"为：本质目标 / 反目标 / 约束 / 可信事实 / 成功标准
  └─ 新增"语义成功"规则：不以表面信号替代语义正确性

S-03（角色规则层）
  └─ 新增任务锚 [STD]：复杂/长任务开始前必须声明任务锚

developer-handbook（操作细则层）
  ├─ 任务锚模板（目标 + 反目标 + 不变量 + 成功标准）
  ├─ 合并/变基冲突解决细则（6 条）
  ├─ 错误/异常修复细则（3 条）
  └─ 字段/接口变更细则（3 条）
```

### Feature.task_anchor 持久化与系统提示词注入

```
Feature.task_anchor (DB TEXT)
  → builder.ts buildFeatureVariables()
    → {{feature_task_anchor_block}}（空或完整 <task_anchor> 区块）
      → S-01 项目上下文注入
        → 系统提示词 [HARD] 区块，每轮 ~50% 注意力权重
```

当 `task_anchor` 非空时，注入形式为：

```
<task_anchor>
[HARD] 以下任务锚在每次关键决策前必须重新对照，不得静默偏离：

{用户/系统写入的任务锚内容}
</task_anchor>
```

### 任务锚格式

```markdown
### 任务锚

#### 本质目标
[为什么做，要达成什么语义状态]

#### 反目标
- [操作类型] 不得 [具体后果]

#### 语义不变量
- [事实/决定]：已确认，来源：[...]，不可被覆盖

#### 成功标准
- [可验证的检验方式]
```

## 生效路径

- `.meta/prompts/prompts/B-01-身份与责任契约.md`：反目标概念 + 语义成功规则
- `.meta/prompts/prompts/S-03-研发者手册.md`：任务锚 [STD] 规则
- `.meta/prompts/prompts/S-01-项目上下文.md`：`{{feature_task_anchor_block}}` 注入点
- `.meta/skills/developer-handbook/SKILL.md`：任务锚模板 + 场景细则
- `.meta/prompt-evaluations/prompt-behavior-samples.json`：PE008 评估样本
- `src/prompt-center/builder.ts`：`feature_task_anchor_block` 变量生成
- `src/shared/domain-types.ts`：Feature.task_anchor 字段
- `src/persistence/schema.ts`：feature 表 task_anchor 列
- `src/persistence/migrations.ts`：`ensureFeatureTaskAnchorColumn` 迁移
- `src/persistence/store.ts`：createFeature/updateFeature 支持 task_anchor

## 改动范围

| 文件 | 改动 |
|---|---|
| B-01 | 行动前识别加反目标；新增语义成功规则 |
| S-03 | 新增任务锚 [STD] |
| S-01 | 新增 `{{feature_task_anchor_block}}` |
| developer-handbook | 任务锚模板（1 节）+ 场景细则（3 组 12 条） |
| prompt-behavior-samples.json | PE008 新增 |
| domain-types.ts | Feature.task_anchor 字段 |
| schema.ts | feature 表 task_anchor 列 |
| migrations.ts | ensureFeatureTaskAnchorColumn |
| store.ts | createFeature/updateFeature 支持 task_anchor |
| builder.ts | feature_task_anchor_block 变量 |
| repo-cleanup-test.ts | 补充 task_anchor 字段 |

## 验证

- TypeScript 编译零错误
- 全部 35 个现有测试通过
- 新增 PE008 评估样本覆盖任务锚创建、反目标遵守、语义成功标准

## 风险与决策记录

- **task_anchor 的写入时机**：当前由研发者（AI）在阶段二需求收敛时主动写入，系统不做强制校验。后续可考虑在 developer-handbook 中增加更明确的任务锚创建触发条件
- **task_anchor 的清空时机**：Feature 合入后 task_anchor 不再有语义意义，当前未做自动清空。后续可在 Feature 完成时由系统清空
- **与现有"行动前识别"规则的关系**：B-01:33 的"行动前识别"被扩展而非替换。新规则是旧规则的增强——补充了"反目标"维度和"语义成功"判定标准，不改变已有行为语义
