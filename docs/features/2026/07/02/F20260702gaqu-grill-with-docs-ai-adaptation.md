---
id: F20260702gaqu
title: grill-with-docs-ai-adaptation
tags: [sop, adversarial-review, grill-with-docs]
modules: [cd-shared, cd-design, cd-review]
doc_kind: spec
---

# F20260702gaqu — grill-with-docs 技巧 AI 化：沉淀与扩展

## 状态

- **阶段**：design
- **创建时间**：2026-07-02
- **Issue**：grillwithdoc的ai化

## 背景

[grill-with-docs](https://www.aihero.dev/grill-with-docs) 是一个社区热门 Claude Code skill，核心功能是让 AI 对用户的方案进行"盘问式"需求澄清。用户触发后，AI 逐个提问、探索代码库、挑战术语、用具体场景压力测试、交叉验证代码，并将澄清结果内联更新到 CONTEXT.md 和 ADR。

本 feature 分析两个方向：
1. **AI-to-user 沉淀**：grill-with-docs 的哪些技巧可以沉淀到 Snail Shell 的架构师工作流中
2. **AI-to-AI 扩展**：这些技巧是否能用于 AI 之间的协作，提升对抗性审视的质量

## [design-time]

### grill-with-docs 核心技巧拆解

| # | 技巧 | 机制 | 价值 |
|---|------|------|------|
| T1 | 追问式访谈 | 逐个提问，等用户回答后再继续 | 迫使用户逐步澄清，避免一次性模糊回答 |
| T2 | 代码库优先 | 能从代码找到答案的不问用户 | 减少无效提问，提升效率 |
| T3 | 术语表挑战 | 对照 CONTEXT.md 挑战用词不一致 | 保持术语一致性，防止概念漂移 |
| T4 | 模糊语言精炼 | 用户说"account"时追问是 Customer 还是 User | 消除歧义，建立精确语义 |
| T5 | 场景压力测试 | 用具体边界场景探测设计边界 | 暴露逻辑漏洞，迫使显式定义边界 |
| T6 | 代码交叉验证 | 用户描述与实际代码矛盾时指出 | 防止认知偏差，验证假设 |
| T7 | 内联文档更新 | 术语澄清后立即更新 CONTEXT.md | 实时沉淀，不丢失上下文 |
| T8 | ADR 谨慎创建 | 仅对不可逆/有取舍/令人意外的决策创建 ADR | 记录真正有价值的决策 |

### Part 1：AI-to-user 沉淀分析

#### 现状对比

Snail Shell 架构师在 design 阶段已有需求对齐环节，但对比 grill-with-docs：

| 维度 | grill-with-docs | Snail Shell 架构师现状 | 差距 |
|------|----------------|----------------------|------|
| 提问方式 | 追问式，逐个深入 | 需求分析时有提问，但无"逐个等待反馈"的纪律 | 中 |
| 场景测试 | 主动构造边界场景压力测试 | 检查清单中有"是否覆盖所有场景"，但无主动构造机制 | **高** |
| 术语管理 | 系统性挑战 + 内联更新 CONTEXT.md | 无系统性术语管理 | **高** |
| 代码验证 | 用户描述 vs 代码矛盾时主动指出 | 设计阶段以分析为主，代码验证偏弱 | 中 |
| 文档沉淀 | 实时更新 CONTEXT.md + ADR | Feature 文档 + 决策记录，无术语表 | 低 |

#### 可沉淀的技巧

**高价值（应沉淀）：**

1. **场景压力测试（T5）** — 当前架构师审视检查点是"方案是否覆盖所有已知场景"，但这是被动检查。grill-with-docs 的做法是**主动构造**边界场景来探测设计。例如：当设计"Stage Suggestion"功能时，主动构造"用户在 Stage-2 提交但 Suggestion 仍指向 Stage-1"的场景。这能发现纯逻辑分析遗漏的问题。

2. **术语表挑战（T3 + T4）** — Snail Shell 项目已积累了大量领域术语（Stage、Issue、Signal、Dispatch 等），但无正式术语表。新成员（包括 AI agent）容易混淆。沉淀为：架构师在需求对齐阶段维护一份项目级 CONTEXT.md，对齐阶段的提问必须挑战术语一致性。

3. **代码交叉验证（T6）** — 架构师的"禁止用代码反驳用户"规则与 grill-with-docs 的"交叉验证"看似矛盾，实则互补。规则禁止的是"用现有代码反驳用户的**新设计意图**"，而 T6 的价值是"验证用户**事实描述**是否与代码一致"。应明确区分：事实验证可以做，意图反驳不行。

**中等价值（可选沉淀）：**

4. **追问式访谈（T1）** — 当前架构师在需求对齐时已有提问环节，但缺乏"逐个等待反馈"的纪律。可以作为建议性指导（非 HARD 规则），鼓励架构师在复杂需求澄清时采用。

**低价值（不需沉淀）：**

5. **代码库优先（T2）** — 架构师已有代码探索能力，这是默认行为，不需额外规则。
6. **内联文档更新（T7）** — Snail Shell 已有 Feature 文档 + 决策记录机制，比 CONTEXT.md 更结构化。
7. **ADR 创建（T8）** — Snail Shell 的 Feature 文档已承担 ADR 功能。

### Part 2：AI-to-AI 扩展分析

#### 核心问题

grill-with-docs 是 AI 盘问**用户**的技巧。在 AI-to-AI 场景中，"被盘问方"变成了另一个 AI agent。关键差异：

| 维度 | AI-to-user | AI-to-AI | 影响 |
|------|-----------|----------|------|
| 被问方 | 用户（有领域知识，表达可能模糊） | AI agent（有代码访问权，表达精确但可能有逻辑盲区） | 提问策略需改变 |
| 目标 | 澄清需求 | 验证设计/代码正确性 | 从"澄清"转向"验证" |
| 交互模式 | 一对一访谈 | 对抗性交叉审视 | 需要结构化产出 |
| 成本 | 每个问题消耗用户时间 | 每个问题消耗 token + 延迟 | 不能无限追问 |

#### 现有机制分析

Snail Shell 的 AI-to-AI 协作已有以下对抗机制：

**已有的强机制（不需要 grill-with-docs 补充）：**
- **独立分析 + 交换对抗**（cross-review.md）：两位架构师背靠背分析后交换审视
- **质疑义务量化**：risk ≥ 2, gap ≥ 1, alternative ≥ 1
- **禁用话术清单**：防止形式主义绕过
- **零成本同意对抗**：adversarial_artifact 要求结构化证明
- **相似度检测**：LCS > 80% 标记为可能抄袭

**存在的结构性弱点（grill-with-docs 可以补充的）：**

1. **审视缺乏场景探测**

   当前流程：审查者/架构师-2 完成独立分析 → 产出审视报告 → 作者回应。审视报告是一次性的完整产出。

   问题：独白式审视倾向于**逻辑分析**（"这个设计有 X 问题"），缺乏**场景探测**（"如果发生 Y，系统会怎样？"）。逻辑分析能发现设计缺陷，但场景探测能发现**边界模糊**。

   grill-with-docs 的启示：在审视报告中主动构造边界场景，以"当 X 发生时，系统应该做 Y 还是 Z？"的形式提出——迫使设计者显式回答，而非笼统地指出问题。场景在审视报告中一次性提出，保持独白式效率。

2. **术语一致性无跨 agent 保障**

   当前状态：每个 agent 独立理解术语，无共享术语表。同一个概念在不同 agent 的输出中可能用不同名称。

   grill-with-docs 的启示：在交叉审视中加入"术语一致性检查"维度。采用 lazy creation——审视检查发现问题时才创建 CONTEXT.md，不预先引入维护成本。

3. **代码验证的不对称性**

   当前状态：adversarial_artifact 要求 `independent_verification`（执行命令验证），但这是针对**代码变更**的验证。对于**设计文档**中的事实性声明（"当前系统支持 X"），没有系统性验证机制。

   grill-with-docs 的启示：在审视中加入"事实性声明验证"——审查者必须验证设计文档中关于现状的描述是否与代码一致。

#### 扩展方案：将 grill-with-docs 技巧融入对抗性审视

**不建议创建独立的"grill"机制**，而是将高价值技巧融入现有 cross-review 框架。

**融入点 1：场景压力测试 → scenario_coverage 强化**

场景压力测试是**探测手段**，不是**判断产出**。`critique_obligation` 管"发现了什么问题"（risk/gap/alternative），`scenario_coverage` 管"覆盖了什么场景"。将场景压力测试归入 `scenario_coverage` 而非 `critique_obligation`，保持语义一致性。

强化 `scenario_coverage`，新增 `constructed_scenarios` 子字段：

```
scenario_coverage:
  identified_scenarios: [...]     // 已有场景
  constructed_scenarios:          // 审查者主动构造的边界场景
    - scenario: "当 Stage-2 提交但 Suggestion 仍指向 Stage-1 时"
      question: "系统应该自动修正 Suggestion 还是拒绝提交？"
    - scenario: "当两个 Reviewer 同时对同一文件提出 conflicting findings 时"
      question: "developer 应该以谁的意见为准？"
  coverage_ratio: 1.0
```

**数量约束**：`constructed_scenarios` ≥ 2。
**质量约束**：场景必须触及设计文档中未显式定义边界的行为。审查者构造的场景如果只是复述设计文档已覆盖的情况，不计入。
**coverage_ratio 语义**：`coverage_ratio = reviewed / identified`，仅计算 identified scenarios。`constructed_scenarios` 是独立强制约束（≥2），不参与 ratio 计算。
**防重叠约束**：审查者不得将同一发现同时计入 gap 和 constructed_scenarios。如果 constructed_scenarios 的 question 未被设计者在回应中回答，则该场景自动升级为 gap，从 constructed_scenarios 中移除。
**交互模式**：场景压力测试在审视报告中一次性提出，设计者在回应中一次性回答。不引入逐个提问的交互模式，保持独白式审视的效率。
**stage 适配**：场景压力测试仅 design 阶段使用（`scenario_coverage.constructed_scenarios`）。review 阶段不使用场景压力测试，由 `file_coverage` + `adversarial_findings`（dimension: `"completeness"`）承接实现完整性检查。

场景压力测试与现有 "gap"（遗漏场景）的区别：
- Gap 是"你漏了什么"（审查者指出遗漏）
- 场景压力测试是"如果这样呢？"（审查者构造场景，设计者必须回答）

场景压力测试更有价值，因为它迫使设计者**显式**定义边界，而非让审查者猜测设计者意图。

**融入点 2：术语一致性检查 → 条件化审视检查点**

采用 grill-with-docs 的 lazy creation 原则——不要求预先创建 CONTEXT.md，仅在审视发现问题时才创建。

在 cross-review.md 的"对抗性审视检查点"中加入：

```
- 是否存在同一概念使用不同名称的情况？（同一设计文档/对话中）
- 是否存在同一名称指代不同概念的情况？
```

**分级处置标准**：

| 级别 | 场景 | 处置 |
|------|------|------|
| L1 文档内部不一致 | 同一文档中同一概念用了两个名字 | 直接修正设计文档 |
| L2 跨 agent 不一致 | 两位架构师对同一概念用了不同名字 | 在决策记录中记录澄清 |
| L3 项目级不一致 | 不同 SOP/文档中术语冲突 | 建议建立 CONTEXT.md |

CONTEXT.md 的创建是审视的**产出**，不是**前提**。仅 L3 级别才建议建立 CONTEXT.md。

**融入点 3：事实性声明验证 → adversarial_findings 维度扩展**

复用现有 `adversarial_findings` 结构，新增 dimension `"fact_verification"`。不新增顶层字段，不改变 `AdversarialArtifact` 类型定义，不需要引擎层校验规则变更。

`adversarial_findings` 是单向的（"这里有问题"），`fact_verification` 是双向的（"声明 vs 代码证据"）。通过严格输出格式模板约束 LLM 产出：

```json
{
  "dimension": "fact_verification",
  "finding": "声明：当前系统支持 Stage 间自动流转 | 代码证据：auto-advance.ts:45 仅处理同一 Stage 内的建议推进（evaluate() 方法检查 stage_id 一致性） | 结论：contradicted",
  "disposition": "已修正设计文档第 3.2 节"
}
```

**finding 字段格式约束**：必须包含三段——`声明：{设计文档中的事实性声明} | 代码证据：{实际代码内容 + 位置} | 结论：verified / contradicted / unverifiable`

**stage 适配**：事实验证在 design + review 阶段均可使用。design 阶段验证设计假设，review 阶段验证实现是否符合设计。

如果后续发现事实验证需要更强的结构化约束（如引擎层强制校验 claim 与 source_file 的关联），再升级为独立字段。

### 核心业务行为

1. **当审查者执行 design 阶段交叉审视时**，必须在 `scenario_coverage.constructed_scenarios` 中构造至少 2 个具体边界场景（"当 X 时，系统应该 Y 还是 Z？"），场景必须触及设计文档中未显式定义边界的行为，且不得与 gap 双重计入
2. **当设计文档中包含事实性声明时**（如"当前系统支持 X"），审查者必须在 `adversarial_findings` 中以 dimension `"fact_verification"` 验证该声明与代码一致，finding 字段必须遵循"声明/证据/结论"三段格式
3. **当审视检查发现术语不一致时**，按分级标准处置：L1 文档内部不一致直接修正文档，L2 跨 agent 不一致在决策记录中澄清，L3 项目级不一致建议建立 CONTEXT.md
4. **当审查者构造场景压力测试时**，必须在审视报告中一次性提出，设计者在回应中一次性回答（保持独白式审视效率）
5. **当 review 阶段审查者执行对抗性检查时**，不使用场景压力测试，由 `file_coverage` + `adversarial_findings`（dimension: `"completeness"`）承接实现完整性检查

### 不适用场景

以下 grill-with-docs 技巧**不建议**引入 AI-to-AI 场景：

| 技巧 | 不适用原因 |
|------|-----------|
| 逐个等待反馈（T1 的严格版） | AI agent 可以一次性处理多个问题，逐个提问会增加延迟但不提升质量；且会消耗有限的交互轮次（当前最多 3 轮） |
| 内联更新 CONTEXT.md（T7） | AI-to-AI 的文档更新应通过 Feature 文档机制，不应引入第二套文档体系 |
| ADR 创建（T8） | Feature 文档已承担此功能 |

### 已识别风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 审视复杂度膨胀导致审查者凑数 | 场景压力测试要求数量 + 质量双重约束；事实验证复用现有结构而非新增顶层字段 |
| 场景压力测试与 gap 语义重叠 | 归入 `scenario_coverage` 而非 `critique_obligation`；防重叠约束——不得双重计入，未回答的 question 自动升级为 gap |
| 术语检查无参照基准 | 条件化 lazy creation + 三级分级处置（L1 修正文档 / L2 决策记录 / L3 CONTEXT.md） |
| fact_verification 语义不匹配 | 复用 adversarial_findings + 严格输出格式模板（声明/证据/结论三段） |
| 通用战术层跨 SOP 复用是虚假承诺 | 战术文档分双层：抽象层（思维模型，任何 SOP 可引用）+ 适配层（code-delivery 结构映射） |
| review 阶段无 scenario_coverage 承接 | review 阶段不使用场景压力测试，由 file_coverage + completeness 承接 |
| coverage_ratio 语义未定义 | 明确 `reviewed / identified`，constructed_scenarios 独立约束不参与 ratio |

### 不兼容更新

无。本 feature 为增量扩展，不改变现有行为。

### 变更影响分析

- **后端**：无类型变更（复用现有 `adversarial_findings` + `scenario_coverage` 结构）
- **前端**：无
- **提示词/SOP**：见下方变更清单

#### 变更清单

| 变更 | 类型 | 说明 |
|------|------|------|
| `cd-shared/references/adversarial-review-tactics.md` | **新建** | 通用对抗性审视战术，双层结构：抽象层（思维模型，任何 SOP 可引用）+ 适配层（code-delivery 结构映射）。包含 stage 适配规则（场景压力测试仅 design 阶段、事实验证 design+review、术语检查 design 为主） |
| `cd-shared/references/adversarial-artifact-protocol.md` | 修改 | `scenario_coverage` 新增 `constructed_scenarios` 子字段定义；说明 `fact_verification` dimension 的使用方式 |
| `cd-design/references/cross-review.md` | 修改 | 审视检查点引用通用战术 + design 阶段适配（`scenario_coverage.constructed_scenarios`） |
| `cd-review/references/adversarial-check.md` | 修改 | 检查维度引用通用战术 + review 阶段适配 |

#### 不变更的模块

| 模块 | 原因 |
|------|------|
| 后端引擎（auto-advance.ts、port.ts） | 不新增顶层字段，不改变 `AdversarialArtifact` 类型定义 |
| 前端 UI | 无 UI 变更 |
| SOP 定义（code-delivery.yaml） | 不改变阶段结构或角色分配 |
| 质疑义务（critique_obligation） | 场景压力测试不属于质疑义务，归入 scenario_coverage |

#### 分层设计

战术定义在通用层（`cd-shared/references/adversarial-review-tactics.md`），SOP 文件只做"引用 + 适配说明"。其他 SOP（如演进治理）可直接引用通用战术，不需要重复定义。

### 关键设计决策记录

| 决策点 | 正方论点 | 反方论点 | 最终决策 | 参与者 |
|--------|---------|---------|---------|--------|
| 融入现有机制 vs 创建独立 skill | 减少机制碎片化，复用已有框架；避免 agent 需要学习新流程 | 可能增加现有机制的复杂度 | 融入现有机制 | 架构师-1、架构师-2 |
| 场景压力测试归属位置 | 归入 `scenario_coverage`：场景压力测试是探测手段不是判断产出，语义上属于场景覆盖 | 归入 `critique_obligation`：与 risk/gap/alternative 并列更直观 | 强化 `scenario_coverage`，新增 `constructed_scenarios` 子字段（架构师-2 提出，架构师-1 接受） | 架构师-1、架构师-2 |
| 场景压力测试数量与质量 | ≥2 数量约束 + 质量约束（必须触及未显式定义边界的行为）；质量比数量重要 | 2 个可能不足以覆盖复杂设计 | ≥2 作为最低要求，附带质量约束（架构师-2 补充质量约束） | 架构师-1、架构师-2 |
| fact_verification 实现方式 | 复用 `adversarial_findings` + dimension `"fact_verification"`：不改变类型定义、不需要引擎变更、轻量 | 独立字段更结构化，便于后续引擎层校验 | 先用轻量方案验证价值，后续可升级为独立字段（架构师-2 提出，架构师-1 接受） | 架构师-1、架构师-2 |
| 术语表引入策略 | 条件化 lazy creation：审视发现不一致时才创建 CONTEXT.md | 预先创建项目级术语表：新成员（包括 AI agent）容易混淆 | 条件化 lazy creation，CONTEXT.md 的创建是审视产出而非前提（架构师-2 提出，架构师-1 接受） | 架构师-1、架构师-2 |
| 审视交互模式 | 一次性报告提出场景，非逐个提问：保持独白式审视效率 | 逐个提问更能迫使设计者逐步澄清 | 一次性报告（AI 可以一次性处理多个问题，逐个提问只增加延迟不提升质量） | 架构师-1、架构师-2 |
| 通用战术 vs SOP 绑定 | 战术定义在 cd-shared 共享层，SOP 文件只做引用+适配：其他 SOP 可直接复用 | 直接写在 SOP 文件里更简单 | 通用战术层（`cd-shared/references/adversarial-review-tactics.md`），SOP 适配层引用（用户提出） | 架构师-1、用户 |
| 战术文档分层 | 双层：抽象层（思维模型，任何 SOP 可引用）+ 适配层（code-delivery 结构映射） | 单层"通用"已足够 | 双层结构——当前三个战术依赖 code-delivery 特有结构，跨 SOP 复用需抽象层（架构师-2 提出） | 架构师-1、架构师-2 |
| coverage_ratio 语义 | `reviewed / identified`，constructed_scenarios 独立约束不参与 ratio | ratio 包含 constructed_scenarios | 明确分离两个约束：ratio 管 identified，constructed_scenarios ≥2 独立（架构师-2 提出） | 架构师-1、架构师-2 |
| fact_verification 输出格式 | 严格三段格式模板（声明/证据/结论） | 复用 finding 字段不限格式 | 格式约束减少 LLM 自由度，避免声明和证据混在一段文字里（架构师-2 提出） | 架构师-1、架构师-2 |
| 防重叠机制 | 不得双重计入 gap 和 constructed_scenarios；未回答的 question 自动升级为 gap | 无防重叠约束 | 防止审查者将同一发现双重计入以凑数（架构师-2 提出） | 架构师-1、架构师-2 |
| 术语检查处置分级 | 三级：L1 修正文档 / L2 决策记录 / L3 CONTEXT.md | 统一建议建立 CONTEXT.md | 不是所有术语不一致都需要 CONTEXT.md，分级处置更精确（架构师-2 提出） | 架构师-1、架构师-2 |
| review 阶段场景压力测试 | review 阶段不使用场景压力测试，由 file_coverage + completeness 承接 | review 阶段也使用场景压力测试 | design 阶段已完成边界探索，review 阶段职责是验证实现符合设计（架构师-2 提出） | 架构师-1、架构师-2 |

## [development-time]

### 变更类型

prompt-only（仅 SOP/提示词文件变更，无后端/前端代码修改）

### 实际变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `cd-shared/references/adversarial-review-tactics.md` | 新建 | 通用对抗性审视战术，双层结构（抽象层 + code-delivery 适配层），包含 3 个战术：场景压力测试、事实性声明验证、术语一致性检查 |
| `cd-shared/references/adversarial-artifact-protocol.md` | 修改 | `scenario_coverage` 新增 `constructed_scenarios` 子字段定义（>=2）；`adversarial_findings` 添加 `fact_verification` dimension 说明；引擎校验规则新增 R4b |
| `cd-design/references/cross-review.md` | 修改 | `scenario_coverage` 描述更新；新增"通用战术适配（design 阶段）"检查点，引用 3 个战术的 design 阶段适配 |
| `cd-review/references/adversarial-check.md` | 修改 | 检查维度新增"事实性声明验证"；新增"通用战术适配（review 阶段）"章节，说明场景压力测试不适用于 review 阶段 |

### 验证

- 无后端/前端代码变更，无需 `npm run check`
- 变更完整性通过文件内容检查验证：所有 5 条核心业务行为均已在对应文件中实现
