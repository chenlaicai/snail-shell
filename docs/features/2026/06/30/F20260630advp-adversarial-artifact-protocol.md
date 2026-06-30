---
id: F20260630advp
title: adversarial-artifact-protocol
from_ids: []
tags: [collaboration, adversarial, review, design, sop]
modules: [collaboration, sop]
doc_kind: spec
change_type: feature
---

# F20260630advp [sop][New Feature] 对抗产物协议：结构化对抗验证

## 背景

当前 code-delivery SOP 中三组角色关系（架构师×架构师、开发者×审查者、审查者×审查者）的对抗性要求都是行为规则（"必须对抗"、"不能无条件同意"），没有结构化的产物锚点。导致：

1. **审查者的"同意"是零成本操作**：可以不执行任何验证就说"同意"
2. **交叉审视可被跳过**：两位审查者可以默契放水，互相同意
3. **共识信号无来源验证**：`consensus: true` 只验证"两个不同 agent 都发了信号"，不验证"信号发出前是否经历了对抗过程"

**典型案例**：开发者说"CI 通过了，PR 已 rebase"，审查者直接回复"明白，我同意"——零独立验证，零对抗。

## 目标

1. 对抗性从"建议"升级为"门禁"——没有合格对抗产物，不允许发 `consensus: true`
2. 三组关系共享统一的对抗产物协议，同时保留各阶段的特有要求
3. 引擎层能语义校验对抗产物的真实性（不是 schema 校验，是内容校验）

## 非目标

- 不修改 `auto-advance.ts` 的自动推进逻辑（只增加产物校验）
- 不改变阶段流转的触发方式（仍然是 agent 发信号）
- 不引入人工审批环节（对抗产物由 agent 自行产出，系统自动校验）
- 不统一三组关系的描述方式（保留各自的对抗性质：互补性/攻防性/互验性）

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当架构师发 `consensus: true` 时 | 信号必须携带对抗产物，包含独立验证、对抗发现和审计轨迹 |
| B2 | 当审查者发 `consensus: true` 时 | 信号必须携带对抗产物，包含独立验证、对抗发现、文件处置和 CI 独立确认 |
| B3 | 当对抗产物缺少必填字段时 | 引擎拒绝接收信号，agent 必须补充后重新发出 |
| B4 | 当两位审查者的独立验证输出雷同时 | 引擎阻断推进，标记为"可能抄袭" |
| B5 | 当对抗产物中 `audit_trail` 缺少 `cross_review_read` 事件时 | 引擎拒绝接收信号 |
| B6 | 当对抗产物通过校验时 | 正常进入 `auto-advance` 评估流程 |

## 设计

### 1. 对抗产物协议（通用字段）

在 `cd-shared` 中定义通用对抗产物结构，所有 `consensus: true` 信号必须携带。

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

**关键约束**：
- `audit_trail.events` 中必须包含 `cross_review_read` 事件，且时间戳晚于 `review_started`
- `independent_verification` 的 `actual_output` 长度不得少于 20 字符
- `adversarial_findings` 不得全部为空数组

### 2. Design 阶段特有字段（架构师×架构师）

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
    coverage_ratio: number;  // 必须 = 1.0
  };
}
```

### 3. Review 阶段特有字段（审查者×审查者 / 审查者×开发者）

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

### 4. 数据模型定位

`adversarial_artifact` 是 `StageTransitionSuggestion` 的**顶层字段**，不是嵌套在 `gate_evidence` 内部。

```typescript
// port.ts
interface StageTransitionSuggestion {
  // ... 现有字段 ...
  consensus?: boolean;
  positions?: Position[];
  review_round?: number;
  gate_evidence?: Record<string, unknown>;  // 检查项清单（gate ID → 证据字符串）
  adversarial_artifact?: AdversarialArtifact;  // 对抗产物（新增，顶层）
}
```

**理由**：
- `gate_evidence` 的语义是"gate ID → 证据字符串"的扁平 map，`allGatesPassed` 按 `typeof value === "string"` 校验，嵌套对象会被误判为失败
- `consensus`、`positions`、`review_round` 已经是顶层的对抗性字段，`adversarial_artifact` 应与它们平级
- 引擎校验逻辑分离：`allGatesPassed` 检查 `gate_evidence`，`validateAdversarialArtifact` 检查 `adversarial_artifact`

### 5. 引擎层语义校验

在 `auto-advance.ts` 的 `evaluate` 方法中增加对抗产物校验。不做 schema 结构校验（LLM 产出 JSON 不可靠），做语义内容校验：

**校验规则**：

| 规则 | 类型 | 说明 |
|------|------|------|
| R1 | 阻断 | `StageTransitionSuggestion` 必须包含顶层 `adversarial_artifact` 字段 |
| R2 | 阻断 | `audit_trail` 必须包含 `cross_review_read` 事件 |
| R3 | 阻断 | `independent_verification` 的 `actual_output` 长度 >= 20 字符 |
| R4 | 阻断 | Design 阶段：`critique_obligation.items` 长度 >= 4（risk>=2 + gap>=1 + alternative>=1） |
| R5 | 阻断 | Review 阶段：`file_coverage.coverage_ratio` = 1.0 |
| R6 | 阻断 | 两位审查者的 `independent_verification` 输出雷同（相似度 > 80%） |
| R7 | 告警 | `adversarial_findings` 全部为"无问题"（不阻断，但标记） |

**校验位置**：在 `evaluate` 方法的 `allGatesPassed` 检查之后、生成 `suggestions` 之前。

**校验失败处理**：信号被拒绝，不进入 `suggestions` 数组。系统通过 `onDisagreement` 回调通知用户"对抗产物不合规"。

### 6. 审查者×开发者关系

不单独定义对抗产物。对抗产物链条：

```
审查者产出检视报告（ReviewAdversarialArtifact）
  → 开发者回应 + 修复（输入，不是对抗产物）
    → 审查者复检产出（ReviewAdversarialArtifact，包含对开发者回应的逐条处置）
```

复检报告的 `adversarial_findings` 必须包含：
- 对开发者回应的逐条处置（同意/不同意+理由）
- 对修复 commit 的独立验证
- 修复是否引入新回归的判断

## 生效路径

| 变更点 | 说明 |
|--------|------|
| `cd-shared` | 新增 `references/adversarial-artifact-protocol.md`，定义通用字段 schema |
| `cd-design` | `references/cross-review.md` 引用通用协议，补充 Design 特有字段要求 |
| `cd-review` | `references/cross-review.md` 引用通用协议，补充 Review 特有字段要求 |
| `cd-review` | `references/adversarial-check.md` 更新，要求对抗发现必须结构化产出 |
| `port.ts` | `StageTransitionSuggestion` 新增顶层 `adversarial_artifact` 字段 |
| `auto-advance.ts` | `evaluate` 方法增加对抗产物语义校验（`validateAdversarialArtifact`） |
| 各 SKILL.md | 信号协议更新，`consensus: true` 必须携带 `adversarial_artifact` |

## 设计约束摘要

- **统一执行模式**：三组关系共享通用对抗产物协议，各阶段补充特有字段
- **顶层字段定位**：`adversarial_artifact` 是 `StageTransitionSuggestion` 的顶层字段，与 `gate_evidence` 平级，不嵌套在 `gate_evidence` 内部
- **语义校验而非 schema 校验**：LLM 产出结构化数据不可靠，引擎做内容校验
- **审计轨迹必填**：`cross_review_read` 事件是门禁，没有就拒绝信号
- **独立验证不可伪造**：`actual_output` 长度 >= 20 字符，且两位审查者的输出不得雷同
- **开发者不发信号**：审查者×开发者关系的对抗产物由审查者的复检报告覆盖

## 关键决策记录

| 决策点 | 正方论点 | 反方论点 | 最终决策 |
|--------|---------|---------|---------|
| 三组关系是否统一描述 | 统一降低认知成本 | 三组对抗性质不同（互补/攻防/互验） | 不统一描述，统一执行模式 |
| `scope_coverage` 是否通用字段 | 通用字段减少重复定义 | 设计阶段的覆盖是场景维度，review 是文件维度，强统一会逼 agent 捏造数据 | 移至阶段特有字段 |
| 引擎校验方式 | schema 拦截更严格 | LLM 产出 JSON 可能 schema 不合规，拦截会导致"产出→被拒→修正"死循环 | evaluate 内语义校验 |
| 审查者×开发者是否单独定义对抗产物 | 单独定义更明确 | 开发者不发 consensus 信号，不需要对抗产物；审查者复检报告已覆盖 | 不单独定义 |
| `audit_trail` 是否必填 | 过程记录供事后审计 | 增加 agent 产出负担 | 必填，`cross_review_read` 为门禁事件 |
| `adversarial_artifact` 数据模型定位 | 嵌套在 `gate_evidence` 内部，不新增顶层字段 | `gate_evidence` 语义是"gate ID → 字符串"的扁平 map，`allGatesPassed` 按 `typeof value === "string"` 校验，嵌套对象会被误判为失败；且 `consensus`/`positions`/`review_round` 已是顶层对抗性字段 | 顶层字段，与 `gate_evidence` 平级 |

## 验证

```bash
# V1: adversarial-artifact-protocol.md 存在
ls data/file/skills/cd-shared/references/adversarial-artifact-protocol.md
# 预期: 文件存在

# V2: cd-design cross-review.md 引用通用协议
grep "adversarial-artifact-protocol" data/file/skills/cd-design/references/cross-review.md
# 预期: 命中

# V3: cd-review cross-review.md 引用通用协议
grep "adversarial-artifact-protocol" data/file/skills/cd-review/references/cross-review.md
# 预期: 命中

# V4: port.ts 包含顶层 adversarial_artifact 字段
grep "adversarial_artifact" src/app/issue-collaboration/port.ts
# 预期: 命中 StageTransitionSuggestion 接口

# V5: auto-advance.ts 包含对抗产物校验逻辑
grep "adversarial_artifact\|cross_review_read\|validateAdversarialArtifact" src/app/issue-collaboration/auto-advance.ts
# 预期: 命中

# V6: 各 SKILL.md 信号协议包含 adversarial_artifact
grep "adversarial_artifact" data/file/skills/cd-design/SKILL.md
grep "adversarial_artifact" data/file/skills/cd-review/SKILL.md
# 预期: 均命中

# V7: 类型检查
npx tsc --noEmit
# 预期: 无错误

# V8: 测试
npm test
# 预期: 通过
```

## 关联

- **触发 Issue**：开发者说有效检视者就同意放过了（Issue ID: 301a1810-d148-475e-9192-64649aa5f8b7）
