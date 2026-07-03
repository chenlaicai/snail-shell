# 对抗产物协议

## 目的

为 code-delivery SOP 的三组对抗关系（架构师×架构师、审查者×审查者、审查者×开发者）建立统一的结构化对抗产物协议，使 `consensus: true` 信号必须携带对抗产物，引擎层做语义校验。

## 通用字段

所有 `consensus: true` 信号必须携带 `adversarial_artifact`，包含以下通用字段：

```typescript
interface AdversarialArtifact {
  // 独立验证：证明自己执行了验证，不是引用别人的
  independent_verification: {
    command: string;       // 执行了什么命令
    actual_output: string; // 实际输出（截断到合理长度）
    executed_at: string;   // ISO 时间戳
  }[];

  // 对抗发现：证明自己真的找了问题（即使没找到也要说明找了什么）
  adversarial_findings: {
    dimension: string;     // 检查了什么维度
    finding: string;       // 发现了什么（可以是"无问题"，但必须说明检查了什么）
    disposition: string;   // 处置方式
  }[];

  // 审计轨迹：记录对抗过程中的关键事件
  audit_trail: {
    events: {
      timestamp: string;
      event_type: 'review_started' | 'cross_review_read' | 'disagreement_found' | 'consensus_reached';
      detail: string;
    }[];
  };
}
```

## 关键约束

- `audit_trail.events` 中必须包含 `cross_review_read` 事件，且时间戳晚于 `review_started`
- `independent_verification` 的 `actual_output` 长度不得少于 20 字符
- `adversarial_findings` 不得全部为空数组
- `adversarial_findings` 预定义 dimension `"fact_verification"`（事实性声明验证）。finding 格式：`声明：{声明} | 代码证据：{代码+位置} | 结论：verified/contradicted/unverifiable`

## Design 阶段特有字段（架构师×架构师）

```typescript
interface DesignAdversarialArtifact extends AdversarialArtifact {
  // 质疑义务量化产出
  critique_obligation: {
    items: { type: 'risk' | 'gap' | 'alternative'; content: string }[];
    // 约束：risk >= 2, gap >= 1, alternative >= 1
  };

  // 独立分析过程（禁止直接同意）
  independent_analysis: {
    my_conclusion: string;
    comparison_with_peer: string;
    points_of_agreement: string[];  // 同意的点，必须说明为什么
    points_of_disagreement: string[];
  };

  // 场景覆盖（设计阶段的"范围覆盖"）
  scenario_coverage: {
    scenarios_reviewed: number;
    scenarios_identified: number;
    coverage_ratio: number;  // 必须 = 1.0，= reviewed / identified
    constructed_scenarios: { // 审查者主动构造的边界场景（>=2）
      scenario: string;      // "当 X 发生时"
      question: string;      // "系统应该做 Y 还是 Z？"
    }[];
  };
}
```

## Review 阶段特有字段（审查者×审查者 / 审查者×开发者）

```typescript
interface ReviewAdversarialArtifact extends AdversarialArtifact {
  // 逐文件处置状态
  file_dispositions: {
    path: string;
    status: 'reviewed' | 'not_applicable';
    issues_found: number;
  }[];

  // 交叉审视记录
  cross_review: {
    peer_conclusion_summary: string;
    my_independent_check: string;
    alignment_or_conflict: string;
  };

  // CI 状态独立确认（不接受开发者声明）
  ci_independence: {
    source: 'github_api' | 'checks_page';
    status: string;
    confirmed_at: string;
  };

  // 文件覆盖（review 阶段的"范围覆盖"）
  file_coverage: {
    files_reviewed: number;
    files_in_diff: number;
    coverage_ratio: number;  // 必须 = 1.0
  };
}
```

## 数据模型定位

`adversarial_artifact` 是 `StageTransitionSuggestion` 的**顶层字段**，不是嵌套在 `gate_evidence` 内部。

**理由**：
- `gate_evidence` 的语义是"gate ID → 证据字符串"的扁平 map，`allGatesPassed` 按 `typeof value === "string"` 校验，嵌套对象会被误判为失败
- `consensus`、`positions`、`review_round` 已经是顶层的对抗性字段，`adversarial_artifact` 应与它们平级
- 引擎校验逻辑分离：`allGatesPassed` 检查 `gate_evidence`，`validateAdversarialArtifact` 检查 `adversarial_artifact`

## 引擎层语义校验

在 `auto-advance.ts` 的 `evaluate` 方法中增加对抗产物校验。不做 schema 结构校验（LLM 产出 JSON 不可靠），做语义内容校验：

| 规则 | 类型 | 说明 |
|------|------|------|
| R1 | 阻断 | `StageTransitionSuggestion` 必须包含顶层 `adversarial_artifact` 字段 |
| R2 | 阻断 | `audit_trail` 必须包含 `cross_review_read` 事件 |
| R3 | 阻断 | `independent_verification` 的 `actual_output` 长度 >= 20 字符 |
| R4 | 阻断 | Design 阶段：`critique_obligation.items` 长度 >= 4（risk>=2 + gap>=1 + alternative>=1） |
| R4b | 阻断 | Design 阶段：`scenario_coverage.constructed_scenarios` 长度 >= 2 |
| R5 | 阻断 | Review 阶段：`file_coverage.coverage_ratio` = 1.0 |
| R6 | 告警 | 两位审查者的 `independent_verification` 输出雷同（相似度 > 80%），不阻断但标记 |
| R7 | 告警 | `adversarial_findings` 全部为"无问题"（不阻断，但标记） |
| R8 | 阻断 | Review 阶段：`finding !== "no issues"` 且 `disposition` 为 `"none"` 或空字符串 |

## `disposition` 取值约定（R8）

| 值 | 含义 | R8 行为 |
|----|------|---------|
| `"在当前 PR 修复"` | 开发者已修复，审查者已确认 | 通过 |
| `"withdrawn"` | 审查者确认为误报，主动撤回 | 通过 |
| `"none"` | 未处理 | **阻断** |
| `""` (空字符串) | 未填写 | **阻断** |
| 其他非空字符串 | 自定义处置（向前兼容） | 通过 |

采用黑名单（只阻断 `"none"` 和空）而非白名单：向后兼容现有产物，语义清晰。

## 审查者×开发者关系

不单独定义对抗产物。对抗产物链条：

```
审查者产出检视报告（ReviewAdversarialArtifact）
  → 开发者回应 + 修复（输入，不是对抗产物）
    → 审查者复检产出（ReviewAdversarialArtifact，包含对开发者回应的逐条处置）
```
