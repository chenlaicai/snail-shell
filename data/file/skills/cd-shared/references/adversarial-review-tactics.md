# 对抗性审视通用战术

## 目的

从 grill-with-docs 技巧中提炼高价值审视战术，定义为通用层（任何 SOP 可引用）+ 适配层（code-delivery 结构映射）。其他 SOP（如演进治理）可直接引用通用战术，不需要重复定义。

## 分层结构

- **抽象层**：思维模型，适用于任何对抗性审视场景
- **适配层**：将抽象战术映射到 code-delivery SOP 的具体结构（`scenario_coverage`、`adversarial_findings`、审视检查点）

---

## 战术 1：场景压力测试

### 抽象层

审查者主动构造边界场景，以"当 X 发生时，系统应该做 Y 还是 Z？"的形式提出——迫使被审查者显式定义边界，而非笼统地指出问题。

**与"遗漏场景（gap）"的区别**：
- Gap 是"你漏了什么"（审查者指出遗漏）
- 场景压力测试是"如果这样呢？"（审查者构造场景，被审查者必须回答）

场景压力测试更有价值，因为它迫使被审查者**显式**定义边界，而非让审查者猜测意图。

### 适配层（code-delivery）

**归属**：归入 `scenario_coverage`（场景覆盖），不属于 `critique_obligation`（质疑义务）。场景压力测试是探测手段，不是判断产出。

**结构**：`scenario_coverage` 新增 `constructed_scenarios` 子字段：

```
scenario_coverage:
  identified_scenarios: [...]     // 已有场景
  constructed_scenarios:          // 审查者主动构造的边界场景
    - scenario: "当 X 发生时"
      question: "系统应该做 Y 还是 Z？"
  coverage_ratio: 1.0
```

**约束**：
- 数量：`constructed_scenarios` >= 2
- 质量：场景必须触及设计文档中未显式定义边界的行为。复述设计文档已覆盖的情况不计入
- `coverage_ratio` 语义：`reviewed / identified`，仅计算 identified scenarios。`constructed_scenarios` 是独立强制约束（>=2），不参与 ratio 计算
- 防重叠：不得将同一发现同时计入 gap 和 constructed_scenarios。未回答的 question 自动升级为 gap，从 constructed_scenarios 中移除

**交互模式**：场景压力测试在审视报告中一次性提出，被审查者在回应中一次性回答。不引入逐个提问的交互模式，保持独白式审视的效率。

**stage 适配**：仅 design 阶段使用（`scenario_coverage.constructed_scenarios`）。review 阶段不使用场景压力测试，由 `file_coverage` + `adversarial_findings`（dimension: `"completeness"`）承接实现完整性检查。

---

## 战术 2：事实性声明验证

### 抽象层

当设计文档或方案中包含关于现状的事实性声明（如"当前系统支持 X"）时，审查者必须验证该声明与代码实际状态一致。

**价值**：防止认知偏差，验证假设。逻辑分析能发现设计缺陷，但事实验证能发现**认知错误**。

### 适配层（code-delivery）

**归属**：复用现有 `adversarial_findings` 结构，新增 dimension `"fact_verification"`。不新增顶层字段，不改变 `AdversarialArtifact` 类型定义。

**输出格式约束**：finding 字段必须包含三段——`声明：{设计文档中的事实性声明} | 代码证据：{实际代码内容 + 位置} | 结论：verified / contradicted / unverifiable`

```json
{
  "dimension": "fact_verification",
  "finding": "声明：当前系统支持 Stage 间自动流转 | 代码证据：auto-advance.ts:45 仅处理同一 Stage 内的建议推进（evaluate() 方法检查 stage_id 一致性） | 结论：contradicted",
  "disposition": "已修正设计文档第 3.2 节"
}
```

**stage 适配**：design + review 阶段均可使用。design 阶段验证设计假设，review 阶段验证实现是否符合设计。

---

## 战术 3：术语一致性检查

### 抽象层

检查审视对象中是否存在同一概念使用不同名称、或同一名称指代不同概念的情况。防止概念漂移，保持术语一致性。

### 适配层（code-delivery）

**原则**：lazy creation——不要求预先创建术语表，仅在审视发现问题时才创建。CONTEXT.md 的创建是审视的**产出**，不是**前提**。

**审视检查点**：
- 是否存在同一概念使用不同名称的情况？（同一设计文档/对话中）
- 是否存在同一名称指代不同概念的情况？

**分级处置标准**：

| 级别 | 场景 | 处置 |
|------|------|------|
| L1 文档内部不一致 | 同一文档中同一概念用了两个名字 | 直接修正设计文档 |
| L2 跨 agent 不一致 | 两位架构师对同一概念用了不同名字 | 在决策记录中记录澄清 |
| L3 项目级不一致 | 不同 SOP/文档中术语冲突 | 建议建立 CONTEXT.md |

**stage 适配**：design 阶段为主要使用场景。review 阶段如发现术语不一致，同样适用分级处置。
