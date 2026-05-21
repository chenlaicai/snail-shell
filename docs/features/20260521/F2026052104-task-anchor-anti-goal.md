# F2026052104 任务锚机制：防 AI 表面修复的意图锚定系统

## 背景

AI 在解决 merge conflict、修复错误等操作中频繁出现"为了做而做"的问题——以"消除冲突标记""让错误消失""让 diff 看起来合理"等表面信号替代语义正确性作为完成标准。典型案例：在合并 rebase 时把 intentional removal 的字段直接改回老版本，只因为"冲突消失了"。

根因是三层叠加：

1. **训练偏差**：LLM 被训练成"永远要产出"，63% 的模糊场景下不请求澄清就直接生成代码（ClarifyCoder, Wu et al. 2025）
2. **注意力稀释**：多轮对话中系统提示词注意力权重从 ~50% 降至 ~1%（SGLang 研究），关键目标和约束在对话流中丢失
3. **目标替换**：AI 将隐式优化目标替换为"可即时验证的表面成功"（消除冲突、消除错误），而非"不可即时验证的语义正确"（保留 intentional removal）

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
