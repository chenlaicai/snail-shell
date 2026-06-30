---
id: F20260630uyj5
title: sop-auto-advance-fix
from_ids: [7d916c84-3403-4fd2-8208-9e9b454ef36b]
tags: [collaboration, sop, auto-advance]
---

# F20260630uyj5 — SOP 自动推进全链路修复

## 背景

PR #502（F20260630m8ia）修复了信号提取链路：`set_final_body` → signal 事件 → `detectStageTransition` 全链路通畅。用户能看到"AI建议推进进度"卡片。但 `AutoAdvanceEngine.evaluate()` **从未成功执行自动推进**，stages 仍然不会自动流转。

根因分析发现三类问题：

1. **信号协议歧义**：`consensus` 字段同时承载"对抗共识"和"单人完成"两种语义，引擎与 SKILL.md 对 development stage 的解读矛盾
2. **对抗产物缺失**：`adversarial_artifact` 是最复杂的嵌套 JSON 结构，agent 产出率低，校验失败时静默吞掉
3. **反馈黑洞**：引擎 7 个退出点全部静默，用户无法感知失败原因

## 设计目标

1. **信号协议无歧义**：agent 声明信号类型，引擎按类型路由，不存在隐式推断
2. **失败可见**：每次 evaluate 都返回结构化结果，用户/UI 能看到"为什么不自动推进"
3. **对抗产物可产出**：模板驱动 + 渐进校验，降低 agent 产出门槛
4. **向后兼容**：旧格式信号仍能被正确处理

---

## 一、信号协议：显式 signal_type

### 1.1 新增 `signal_type` 字段

`stage_transition` JSON 新增 `signal_type` 字段，取值为三个互斥类型：

| signal_type | 含义 | 典型阶段 | 必需字段 |
|---|---|---|---|
| `gate_complete` | 单人完成 gate 自检 | development | `gate_evidence` |
| `adversarial_consensus` | 多人对抗达成共识 | design, review | `gate_evidence` + `adversarial_artifact` |
| `disagreement` | 多人对抗存在分歧 | design, review | `positions` |

### 1.2 信号格式示例

**gate_complete（development stage）**：
```json
{
  "stage_transition": {
    "signal_type": "gate_complete",
    "target_key": "review",
    "reason": "代码实现完成，自检通过，PR 已创建",
    "gate_evidence": {
      "dev-01": "src/app/issue-collaboration/collaboration.ts 已修改",
      "dev-02": "npm run check 通过",
      "dev-04": "PR #123 已创建",
      "dev-06": "CI 通过"
    }
  }
}
```

**adversarial_consensus（design stage）**：
```json
{
  "stage_transition": {
    "signal_type": "adversarial_consensus",
    "target_key": "development",
    "consensus": true,
    "reason": "设计文档已锁定，无未解决争议",
    "gate_evidence": {
      "design-01": "Feature 文档已锁定",
      "design-02": "所有争议已解决"
    },
    "adversarial_artifact": { ... }
  }
}
```

**disagreement**：
```json
{
  "stage_transition": {
    "signal_type": "disagreement",
    "target_key": "development",
    "consensus": false,
    "reason": "关于自动推进条件存在分歧",
    "positions": [
      { "speaker": "architect-1", "stance": "for", "argument": "..." },
      { "speaker": "architect-2", "stance": "against", "argument": "..." }
    ]
  }
}
```

### 1.3 向后兼容：隐式推断

当 `signal_type` 缺失时，引擎按以下规则推断（兼容旧格式）：

1. `consensus === false` 或存在 `positions` → `disagreement`
2. `stage.key` 为 design/review 且 `consensus === true` → `adversarial_consensus`（无论 `adversarial_artifact` 是否存在，让 R1 校验正确拦截）
3. `stage.key` 为 development 且存在 `gate_evidence` → `gate_complete`
4. 其他 → `gate_complete`

**关键约束**：`inferSignalType` 必须结合 `stage.key` 判断，防止 design/review 阶段的旧格式信号（`consensus: true` 但遗漏 `adversarial_artifact`）被误路由到 `gate_complete` 路径。

推断结果写入日志，标记 `signal_type_inferred: true`。

### 1.4 路由逻辑

```
evaluate(stage, suggestions)
  ├─ signal_type === "disagreement"       → handleDisagreement()
  ├─ signal_type === "gate_complete"      → evaluateGateComplete()
  └─ signal_type === "adversarial_consensus" → evaluateAdversarialConsensus()
```

不再通过 `consensus === undefined` 区分 development 和 adversarial。

---

## 二、引擎返回值：EvaluationResult

### 2.1 数据结构

`evaluate()` 从 `void` 改为返回 `EvaluationResult`：

```typescript
interface EvaluationResult {
  action: "auto_advanced" | "blocked" | "escalated";
  target_key?: string;
  reasons: EvaluationReason[];
}

interface EvaluationReason {
  code: string;           // 唯一标识，如 "CONTEXT_MISSING", "GATE_FAILED"
  severity: "info" | "warning" | "error";
  message: string;        // 人类可读描述
  details?: Record<string, unknown>;
}
```

### 2.2 错误码表

| code | severity | 含义 | 触发条件 |
|---|---|---|---|
| `NO_SIGNALS` | info | 无信号 | suggestions 为空 |
| `CONTEXT_MISSING` | error | 上下文字段缺失 | worktree_path/branch_name/pr_url 未设置 |
| `SPEAKERS_INSUFFICIENT` | warning | 共识 speaker 不足 | adversarial_consensus 但 uniqueSpeakers < 2 |
| `GATE_FAILED` | error | gate 未通过 | gate_evidence 中 required 项缺失或为空 |
| `INCOMPATIBLE_BLOCKED` | warning | [Incompatible] 阻断 | PR 标题含 [Incompatible] |
| `ADVERSARIAL_ARTIFACT_MISSING` | error | 对抗产物缺失 | consensus: true 但无 adversarial_artifact |
| `ADVERSARIAL_VALIDATION_FAILED` | error | 对抗产物校验失败 | R1-R7 任一规则不通过（附具体规则和原因） |
| `R6_SIMILARITY_DETECTED` | warning | 跨 speaker 输出雷同 | independent_verification 相似度 > 80% |
| `R7_ALL_CLEAR_WARNING` | warning | 对抗发现全部"无问题" | adversarial_findings 全为 "no issues" |
| `MERGE_REQUIRES_HUMAN` | info | merge 阶段需人工 | target 为 merge |
| `AUTO_ADVANCED` | info | 自动推进成功 | 所有条件通过 |

### 2.3 协作层消费

```
const result = await this.autoAdvanceEngine.evaluate(stage, suggestions);
await this.notifyConsumers(stageId, "onEvaluationResult", result);
```

协作层根据 `result.action` 决定后续行为：
- `auto_advanced`：UI 刷新 stage
- `blocked`：UI 展示阻断原因（reasons 中 severity >= warning 的项）
- `escalated`：UI 展示决策卡片（disagreement 或 merge_ready）

### 2.4 各退出点的 result 示例

**context 缺失**：
```json
{
  "action": "blocked",
  "reasons": [{
    "code": "CONTEXT_MISSING",
    "severity": "error",
    "message": "自动推进被阻断：Issue 上下文缺少必要字段",
    "details": { "missing_fields": ["worktree_path", "branch_name"] }
  }]
}
```

**gate 未通过**：
```json
{
  "action": "blocked",
  "reasons": [{
    "code": "GATE_FAILED",
    "severity": "error",
    "message": "Gate 自检未通过：dev-06 缺失",
    "details": { "failed_gates": ["dev-06"], "stage": "development" }
  }]
}
```

**对抗产物 R3 校验失败**：
```json
{
  "action": "blocked",
  "reasons": [{
    "code": "ADVERSARIAL_VALIDATION_FAILED",
    "severity": "error",
    "message": "对抗产物校验失败：independent_verification actual_output 不足 20 字符",
    "details": { "rule": "R3", "speaker": "architect-1", "actual_length": 5 }
  }]
}
```

---

## 三、对抗产物：渐进校验 + 模板驱动

### 3.1 渐进校验策略

校验按 R1 → R2 → R3 → R4/R5 → R6 → R7 顺序执行，**遇到第一个失败立即返回**，附带具体规则编号和失败原因。不累积错误——agent 只需关注最先失败的那一条。

```
R1: adversarial_artifact 存在？
  ├─ 否 → ADVERSARIAL_ARTIFACT_MISSING
  └─ 是 ↓
R2: audit_trail 含 cross_review_read？
  ├─ 否 → ADVERSARIAL_VALIDATION_FAILED (R2)
  └─ 是 ↓
R3: actual_output >= 20 字符？
  ├─ 否 → ADVERSARIAL_VALIDATION_FAILED (R3)
  └─ 是 ↓
R4/R5: 阶段特有字段合规？
  ├─ 否 → ADVERSARIAL_VALIDATION_FAILED (R4/R5)
  └─ 是 ↓
R6: 跨 speaker 输出雷同？
  ├─ 是 → R6_SIMILARITY_DETECTED (warning, 不阻断)
  └─ 否 ↓
R7: findings 全为 "no issues"？
  ├─ 是 → R7_ALL_CLEAR_WARNING (warning, 不阻断)
  └─ 否 ↓
通过 → 执行自动推进
```

### 3.2 R6 行为变更

当前 R6 是**阻断规则**（相似度 > 80% 直接 return）。变更为 **warning 规则**：
- 相似度 > 80% 时发出 `R6_SIMILARITY_DETECTED` warning
- 不阻断自动推进，但通知用户"两位 agent 的独立验证输出高度相似，可能存在抄袭"
- 理由：R6 的初衷是防止"假对抗"，但阻断过于严格。warning + 用户可见性已足够

### 3.3 模板驱动：降低 agent 产出门槛

在 SKILL.md 的信号协议章节中，提供 **adversarial_artifact 填充模板**，agent 只需替换 `{{placeholder}}`：

```json
{
  "adversarial_artifact": {
    "independent_verification": [
      {
        "command": "{{实际执行的命令}}",
        "actual_output": "{{命令的实际输出，至少20字符}}",
        "executed_at": "{{ISO时间戳}}"
      }
    ],
    "adversarial_findings": [
      {
        "dimension": "{{检查维度，如 completeness/consistency/security}}",
        "finding": "{{发现内容，可以是'无问题'}}",
        "disposition": "{{处置方式}}"
      }
    ],
    "audit_trail": {
      "events": [
        { "timestamp": "{{ISO}}", "event_type": "review_started", "detail": "开始审视" },
        { "timestamp": "{{ISO}}", "event_type": "cross_review_read", "detail": "阅读对方结论" }
      ]
    }
  }
}
```

Design 阶段额外需要 `critique_obligation`、`independent_analysis`、`scenario_coverage`。
Review 阶段额外需要 `file_dispositions`、`cross_review`、`ci_independence`、`file_coverage`。

模板嵌入 SKILL.md，agent 不需要记忆结构。

---

## 四、SKILL.md 对齐

### 4.1 信号协议章节重构

所有角色的 SKILL.md 中"信号协议"章节统一使用 `signal_type` 字段，**删除 `consensus` 字段**（`signal_type` 已承载语义）：

- **cd-development/SKILL.md**：
  - 删除 `consensus: true`（development 无对抗机制）
  - 使用 `signal_type: "gate_complete"`
  - 删除"consensus 固定为 true"的注释

- **cd-design/SKILL.md**：
  - 共识信号使用 `signal_type: "adversarial_consensus"`，**删除 `consensus: true`**
  - 分歧信号使用 `signal_type: "disagreement"`
  - 提供 adversarial_artifact 填充模板

- **cd-review/SKILL.md**：
  - 同 cd-design，使用 `adversarial_consensus` 和 `disagreement`，**删除 `consensus: true`**
  - 提供 review 阶段的 adversarial_artifact 填充模板

**理由**：`consensus` 字段在新协议中是冗余的。保留它会导致 agent 产出 `consensus: true`，触发 `inferSignalType` 的歧义推断。统一删除消除混淆。

### 4.2 Stage Gate 自检章节

gate 自检结果的输出格式保持不变。gate_evidence 的 key 与引擎校验的 gate ID 一一对应。

### 4.3 上下文字段要求

各 SKILL.md 明确列出 `set_context` 必须写入的字段：

| 阶段 | 必须写入的 context 字段 |
|---|---|
| design | `worktree_path`, `branch_name` |
| development | `worktree_path`, `branch_name`, `pr_url` |
| review | `pr_url` |

未写入时引擎返回 `CONTEXT_MISSING`，阻断自动推进。

---

## 五、stage-gate.md 更新

`references/stage-gate.md` 中的"自动推进条件表"更新为：

| 阶段转换 | 自动推进条件 | 升级条件 |
|---|---|---|
| design → development | 2 个架构师均发出 `adversarial_consensus` + design-01/02 通过 + 对抗产物 R1-R5 通过 | `disagreement` 信号 或 R1-R5 校验失败 |
| development → review | `gate_complete` + dev-01~06 通过 | gate_evidence 缺失 |
| review → merge 前置 | 2 个 reviewer 均发出 `adversarial_consensus` + rev-01~03 通过 + 对抗产物 R1-R5 通过 | `disagreement` 信号 或 R1-R5 校验失败 |
| merge 前置 → merge | **不自动推进**，等待用户执行 | — |

新增"失败反馈"章节，说明 `EvaluationResult` 的消费方式。

---

## 六、测试策略

### 6.1 单元测试

- **信号类型推断**：验证 `signal_type` 缺失时的向后兼容推断逻辑
- **信号类型推断误路由防护**：验证 design 阶段旧格式信号（无 `signal_type`，有 `consensus: true`，无 `adversarial_artifact`）正确路由到 `evaluateAdversarialConsensus`，而非误路由到 `evaluateGateComplete`
- **gate_complete 路由**：验证 development stage 正确路由到 `evaluateGateComplete`
- **adversarial_consensus 路由**：验证 design/review stage 正确路由到 `evaluateAdversarialConsensus`
- **ADVERSARIAL_ARTIFACT_MISSING**：验证 `consensus: true` 但无 `adversarial_artifact` 时返回独立错误码（非 `ADVERSARIAL_VALIDATION_FAILED`）
- **EvaluationResult 结构**：验证每个退出点返回正确的 action、reasons、severity
- **渐进校验**：验证 R1-R7 按序执行，首个失败即返回

### 6.2 集成测试

- **development 全链路**：agent 输出 `signal_type: "gate_complete"` → 引擎自动推进
- **design 全链路**：两个 agent 输出 `signal_type: "adversarial_consensus"` → 引擎自动推进
- **失败反馈链路**：agent 输出缺少 gate_evidence → 引擎返回 `blocked` → consumer 收到 `onEvaluationResult`

### 6.3 修复现有测试

- `auto-advance.test.ts`：`createSuggestion` 默认使用 `signal_type: "gate_complete"` 替代 `consensus: undefined`
- 新增 `EvaluationResult` 断言：每个测试不仅验证 `advanceStage` 是否被调用，还验证返回的 reasons

---

## 七、不兼容更新

本次变更包含以下不兼容点：

1. **evaluate() 返回类型**：从 `void` 改为 `EvaluationResult`。所有调用方需要消费返回值。
2. **Consumer 接口**：新增 `onEvaluationResult` 方法。现有 consumer 实现需要添加此方法。
3. **信号格式**：SKILL.md 中的信号示例新增 `signal_type` 字段，删除 `consensus` 字段。旧格式信号仍可处理（向后兼容），但新 agent 应使用新格式。

标记：`[Incompatible]`

### 前端消费层（独立 feature）

`onEvaluationResult` 的前端消费涉及 WebSocket 协议扩展和 UI 组件，与当前引擎层修复独立。当前 feature 先确保引擎层正确产出结构化结果，前端消费作为下一个 feature 跟进。引擎层的 `notifyConsumers("onEvaluationResult")` 已就绪，前端只需实现消费逻辑。

---

## 八、影响面

| 文件/层 | 变更类型 | 说明 |
|---|---|---|
| `auto-advance.ts` | 重构 | 返回 EvaluationResult、signal_type 路由、渐进校验 |
| `port.ts` | 接口扩展 | 新增 EvaluationResult 类型、onEvaluationResult |
| `collaboration.ts` | 消费适配 | 消费 evaluate 返回值、转发 onEvaluationResult |
| `consumer-notifier.ts` | 通知扩展 | 支持 onEvaluationResult 通知 |
| `cd-development/SKILL.md` | 信号格式 | 使用 gate_complete，删除 consensus |
| `cd-design/SKILL.md` | 信号格式 | 使用 adversarial_consensus + 模板 |
| `cd-review/SKILL.md` | 信号格式 | 使用 adversarial_consensus + 模板 |
| `stage-gate.md` | 文档更新 | 条件表 + 失败反馈章节 |
| `auto-advance.test.ts` | 测试修复 | 适配新信号格式 + EvaluationResult 断言 |
| `signal-chain.test.ts` | 测试扩展 | 覆盖 signal_type 推断 |
| WebSocket consumer | 消费适配 | 处理 onEvaluationResult 推送前端 |

---

## 九、设计决策记录

### D1：为什么用显式 signal_type 而不是继续隐式推断？

隐式推断（通过 `consensus` 字段和 `adversarial_artifact` 存在性判断）导致了根因 #1 的语义矛盾。显式声明消除歧义，引擎不需要猜测 agent 的意图。向后兼容层确保旧信号不丢失。

### D2：为什么 R6 从阻断改为 warning？

R6 的初衷是防止"假对抗"（两个 agent 复制粘贴相同的验证输出）。但阻断过于严格——在实际运行中，两个 agent 使用相同命令（如 `npm run check`）得到相同输出是正常的。改为 warning + 用户可见性已足够：用户看到"输出高度相似"的警告后可以手动判断。

### D3：为什么 evaluate 返回值而不是回调？

回调（onBlocked/onReason）会让引擎与通知系统紧耦合。返回值让协作层决定如何消费——可以写日志、推 WebSocket、展示 UI、甚至忽略。引擎保持纯函数式评估逻辑。

### D4：对抗产物校验为什么渐进而不是一次性？

一次性收集所有错误会让 agent 面对一个巨大的错误列表，不知从何修起。渐进校验（首个失败即返回）让 agent 聚焦于当前最紧迫的问题，修复后再触发下一轮校验。这符合"小步快跑"的迭代模式。

### D5：模板驱动是否降低对抗产物的质量？

模板提供结构骨架，但 `actual_output`、`finding` 等字段仍需 agent 填入真实内容。引擎的 R3（长度 >= 20）和 R2（audit_trail 时序）校验确保内容不是占位符。模板的作用是降低"格式错误"的概率，不降低"内容质量"的要求。

### D6：为什么 inferSignalType 必须结合 stage.key？

旧格式信号中，design/review agent 可能遗漏 `adversarial_artifact`（LLM 产出复杂 JSON 的可靠性问题）。如果 `inferSignalType` 仅依赖字段存在性推断，这类信号会回退到 `gate_complete`，被错误路由到 development 的 gate 检查逻辑，可能触发错误的自动推进。结合 `stage.key` 判断确保 design/review 阶段的 `consensus: true` 信号始终路由到对抗产物校验路径，让 R1 正确拦截。

### D7：前端消费层为什么拆分为独立 feature？

`onEvaluationResult` 的前端消费涉及 WebSocket 协议扩展、UI 组件设计、错误码展示逻辑，与当前引擎层修复是独立的关注点。当前 feature 先确保引擎层正确产出结构化结果，前端消费作为下一个 feature 跟进。引擎层的 `notifyConsumers("onEvaluationResult")` 已就绪，前端只需实现消费逻辑。
