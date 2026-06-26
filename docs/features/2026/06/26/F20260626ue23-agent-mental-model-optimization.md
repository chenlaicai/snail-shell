---
id: F20260626ue23
title: agent-mental-model-optimization
from_ids: [F2026062308, F2026051002, F2026052204]
tags: [prompt, agent-thinking]
modules: [prompt, skill-cd-development, skill-cd-review]
doc_kind: spec
---

# F20260626ue23 [prompt] Agent 思维方式优化：从"堵"到"疏"

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

当前 Snail Shell 的 context 工程对 agent 行为的约束方式以**负向禁止**为主：

```
禁止用最小修复绕过问题
禁止用"后续优化""技术债"等说辞逃避
不写向后兼容代码
```

这些约束本身正确，但存在结构性缺陷：

1. **负向指令的遵从率低于正向指令** — LLM 对否定句式的处理存在已知的"否定盲区"（negation blindness），"不要做 X"可能反而激活了 X 相关的表征。Google、OpenAI、Anthropic 的 prompt 最佳实践均建议将否定指令改写为肯定指令。

2. **分散的禁止项缺乏统一世界观** — 当前 T-01 的 12 条规则分布在 identity/judgment/execution/scope/rule_discipline 五个节点中，agent 需要逐条记忆和匹配，而非从一个统一的心智模型推导出正确行为。

3. **未利用 LLM 的训练目标** — LLM 被训练为快速达成用户意图。当系统 prompt 说"慢下来分析"时，可能激发低质量的"表面慢"而非真正的一次性到位。更有效的方式是让 LLM 理解"一次做到位才是最快路径"。

用户提出了三个 AI 时代的洞察：

- **工作量不是拆分理由** — AI 执行效率是人类的数十倍，会话内多步即可完成
- **兼容性是 bug 放大器** — 直接废弃旧方案比维护双轨更安全
- **堵不如疏** — 利用 LLM 的训练目标，引导其"一次做对"而非"不要做错"

## 目标

将 agent 的行为约束从"负向禁止清单"升级为"正向心智模型 + 推论"结构，并重构 T-01 标签为 MECE 设计：

1. 将 T-01 的 6 个标签（identity/mental_model/judgment/execution/scope/rule_discipline）重构为 3 个 MECE 标签：identity（纯身份声明）、constraints（范围边界+规则治理）、behavior（世界观+分析+判断+实现+执行+完成）
2. 去除冗余规则，从 17 条精简为 12 条
3. 补充缺失的坏思维模式：没想明白不抛用户、对所有输入独立判断
4. 在开发者 workflow 中增加思维校准步骤
5. 在审查 adversarial check 中增加完成度审视维度

## 非目标

- 不改变 tenet prompt 的加载/过滤机制
- 不修改 SOP 流程结构或角色分配
- 不修改 B-02（演进治理）和 S-01/S-02（场景层）
- 不新增 reference 文件——修改现有文件

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 agent 加载 T-01 进入任意 SOP 阶段时 | agent 能从心智模型推导出"一步到位优于修补"的行为偏好，而非仅记忆禁止项 | prompt-behavior-samples.json 新增用例 |
| B2 | 当 agent 面临"快速修复 vs 完整方案"选择时 | agent 选择完整方案，并能在推理中引用心智模型的成本分析 | prompt-behavior-samples.json 新增用例 |
| B3 | 当 developer agent 进入实现阶段时 | agent 执行思维校准，确认"代码仓此刻就是最终状态" | cd-development workflow |
| B4 | 当 reviewer agent 执行 adversarial check 时 | agent 增加完成度审视维度（TODO/FIXME/feature flag/兼容桥接） | cd-review adversarial-check.md |

## 设计

### 核心理念：从"行为约束系统"到"思维操作系统"

当前 prompt 工程的主流方式是列出行为约束（"做 X""不做 Y"），这适合人类——因为人类从教训中学习比从原则中推导更自然。但 LLM 的特性不同：

- **LLM 在明确、单一目标下输出质量最高** — 歧义和多约束分散注意力
- **LLM 从原则推导比记忆规则更可靠** — Constitutional AI (Bai et al., 2022) 证明原则式对齐比逐场景规则更可扩展
- **LLM 的正向指令遵从率高于负向指令** — prompt engineering 社区的广泛共识

因此，优化方向不是"加更多禁止项"，而是"给一个正向世界观，让 agent 自己推导出正确行为"。

### 证据分层

本设计涉及的主张按证据强度分层：

| 层级 | 主张 | 来源 |
|------|------|------|
| 论文支撑 | 原则式对齐优于规则式对齐 | Constitutional AI, Bai et al., 2022 (Anthropic) |
| 论文支撑 | CoT 推理框架提升输出质量 | Chain-of-Thought Prompting, Wei et al., 2022 |
| 行业共识 | LLM 对正向指令的遵从率高于负向指令 | Google/OpenAI/Anthropic prompt 最佳实践 |
| 行业共识 | System prompt 作为 agent 的"操作系统" | 2024-2025 agent 架构社区趋势 |
| 综合推演 | 心智模型比禁止清单更能激发高质量推理 | 基于上述三点推导，无直接对照实验 |
| 工程假说 | 利用 LLM 训练目标（快速达成）优于对抗训练目标 | 用户洞察，无直接论文支撑 |

### P1 详设：T-01 标签重构为 MECE 结构

原 6 个标签（identity/mental_model/judgment/execution/scope/rule_discipline）存在重叠：mental_model 与 execution 都描述"怎么做"，judgment 与 execution 的"独立判断"重复，scope 与 execution 的"检查同类对象"重复，rule_discipline 与 mental_model 的"不写兼容代码"重复。

重构为 3 个 MECE 标签：

**`<identity>`**（纯身份声明，1 条）：
- "对判断、行动和输出负责，不当执行器"

**`<constraints>`**（范围边界 + 规则治理，2 条）：
- 用户举例只是线索 + 规则语义层级归属

**`<behavior>`**（世界观 + 行动指导，9 条）：
- 世界观：兼容性认知、效率认知、拆分决策
- 行动：分析→判断→实现→执行→完成

去重效果：原 17 条 → 12 条，净减 5 条。同时补充了 2 条缺失的坏思维模式：
- "没想明白不抛给用户"（解决"没有分析清楚就来问用户"问题）
- "对所有输入独立判断"（解决"别人说啥就认为是对的"问题，覆盖工具输出、历史消息、其他 agent 建议）

### P2 详设：开发者 workflow 增加思维校准

在 `cd-development/references/workflow.md` 的 Phase 3（实现）入口增加思维校准步骤：

```markdown
### Phase 3 入口：思维校准

进入实现前，确认以下心智模型已激活：
- 我将按照设计文档一次性实现完整方案
- 不会留"后续优化"的空间——本次 PR 的范围就是全部范围
- 代码仓此刻就是最终状态——不存在"过渡期"
- 如果发现设计遗漏，立即回到 Phase 2 重新确认，而非边做边补
```

### P2 详设：审查增加完成度审视

在 `cd-review/references/adversarial-check.md` 增加完成度审视清单：

```markdown
### 完成度审视（与代码质量审视并列）

- 是否存在 TODO/FIXME/HACK 注释？
- 是否存在功能开关（feature flag）但未说明何时移除？
- 是否存在"临时"方案但未标记为 [Incompatible]？
- 是否存在兼容性桥接代码（if oldFormat）？
- 测试是否覆盖了新行为的正向和边界场景？
```

## 生效路径

1. `data/file/prompts/T-01-行为准则.md`：3 标签 MECE 重构，所有 agent 所有阶段生效
2. `data/file/skills/cd-development/references/workflow.md`：思维校准步骤，development 阶段生效
3. `data/file/skills/cd-review/references/adversarial-check.md`：完成度审视，review 阶段生效
4. `data/file/skills/cd-shared/references/feature-numbering.md`：修正首位字符规则，与校验器一致

## 设计约束摘要

- **边界**：不改变 SOP 流程、角色分配、加载/过滤机制
- **关键决策**：identity 只保留纯身份声明（1 条），世界观和行为指导全部归入 behavior
- **关键决策**：保留原有规则的语义，只改变表达方式——从禁止项变为推论
- **语义不变量**：所有原有行为约束的语义必须被保留，不得因重构而弱化

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更 |
|------|------|
| `data/file/prompts/T-01-行为准则.md` | 6 标签重构为 3 标签 MECE（identity/constraints/behavior） |
| `data/file/skills/cd-development/references/workflow.md` | Phase 3 入口增加思维校准步骤 |
| `data/file/skills/cd-review/references/adversarial-check.md` | 增加完成度审视清单 |
| `data/file/skills/cd-shared/references/feature-numbering.md` | 修正首位字符规则：首位必须是字母，与校验器一致 |

## 验证

### 通用

- [ ] T-01 修改后，`findByWorkspace` 无 tags 时返回完整内容（含 identity/constraints/behavior）
- [ ] T-01 修改后，原有 12 条规则的语义全部保留
- [ ] `npm run build` 通过

### P1

- [ ] T-01 修改后，agent 能从心智模型推导出"一步到位优于修补"的行为偏好

### P2

- [ ] developer workflow 修改后，Phase 3 入口包含思维校准步骤
- [ ] reviewer adversarial-check 修改后，完成度审视清单可被访问
- [ ] feature-numbering.md 修正后，示例与规则一致

## 关联

- **前置**: F2026062308（重构 Tenet Prompt：本次在其基础上增加心智模型节点）
- **前置**: F2026051002（AI 原生工作原则：本次将其原则内化为心智模型）
- **相关**: F2026052204（兼容性残留清理：本次强化"完美状态"的心智模型表达）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | T-01 标签 MECE 设计 | 3 标签（identity/constraints/behavior）：互斥全量 | 6 标签：每个概念独立标签 | 3 标签：identity 纯身份声明，constraints 纯约束，behavior 包含所有行动指导 | 6 标签存在重叠（mental_model 与 execution、judgment 与 execution 独立判断），MECE 消除冗余 | 用户 + agent | 2026-06-26 |
| D2 | 禁止项是删除还是改写 | 删除：心智模型已覆盖 | 改写：保留语义防止弱化 | 改写：从禁止项变为推论，保留语义 | 重构不等于弱化；"修补成本 > 一步到位成本"比"禁止最小修复"更有力 | 用户 + agent | 2026-06-26 |
| D3 | AI 时间成本模型是否需要论文支撑 | 需要：无证据的规则不可信 | 不需要：工程假说可以标注为假说 | 标注证据层级：论文支撑 / 行业共识 / 综合推演 / 工程假说 | 诚实标注比假装有证据更负责任 | 用户 + agent | 2026-06-26 |
| D4 | feature-numbering 首位字符规则修正 | 修正：规范与校验器必须一致 | 不改：历史文档不影响运行 | 修正规范文档，示例改为字母开头 | 校验器是事实标准，文档应与之一致；旧示例 `F202606238vkw` 首位是数字，按校验器会失败 | 用户 + agent | 2026-06-26 |

## 范围变更记录

1. 自检发现 feature-numbering.md 的字符集规则与 commit 校验器不一致（规范允许首位数字，校验器要求首位字母），新增修正范围。已获用户确认。
2. 用户指出标签设计不是 MECE，将 6 标签重构为 3 标签（identity/constraints/behavior）。identity 纯化为 1 条身份声明，世界观和行为指导归入 behavior。已获用户确认。
3. 架构师审查发现 3 条语义丢失（效率认知、不跳过分析、语义闭合边界），已恢复。已获用户确认。
