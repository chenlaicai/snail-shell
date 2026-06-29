---
id: F20260626m4vx
title: human-intervention-auto-advance
from_ids:
  - F20260626g7rt
  - F20260626v7s5
tags:
  - sop
  - ai-native
  - collaboration
  - automation
modules:
  - issue-collaboration
doc_kind: spec
---

# F20260626m4vx [sop] 人类介入决策分层：对抗共识自动推进 + Merge 硬门禁

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

当前 SOP（code-delivery）中，每个 stage transition 都需要用户手动调用 `advanceStage()`。不管是改一个 typo 还是重构整个架构，用户都必须介入。

**问题**：
1. 简单任务被频繁打断——用户扫一眼就点了 advance，什么都没审
2. 复单任务缺乏结构化辅助——用户看到一大坨文档但不知道该关注什么
3. 对抗机制的信号未被利用——两个架构师/reviewer 的对抗结果是最强的质量信号，但当前对抗完成后还是要等人点按钮

**用户期望**：AI 自行解决大部分问题，两个架构师的对抗形成内部制衡，只有真正需要人时才转给人。**merge 必须控制在用户手中**——整个 issue 过程中 design/development/review 都是可逆的（回退 stage），唯有 merge 是不可逆的（代码进入 main）。

**来源**：本文档从 F20260626g7rt（测试机制设计）中拆分而来。F20260626g7rt 的第二轮红蓝对抗识别出人类介入机制与测试机制在实现层面完全独立（不同文件、不同风险、不同验证标准），捆绑会互相阻塞。

## 目标

- 形式化决策风险分层模型
- 实现对抗共识驱动的自动推进（替代当前的 advanceStage 硬门禁）
- 保持 merge 为唯一硬门禁（用户显式执行）
- 建立审计轨迹和回滚机制

### P1 — 自动推进协议与信号设计

- 定义 agent 的共识/分歧信号协议
- 修改 system reminder：从"永远不要自动推进"改为"通过信号表达共识或分歧"
- 设计自动推进的系统级触发逻辑

### P2 — 实现与集成

- 修改 `collaboration.ts`：添加自动推进逻辑
- 修改 `StageTransitionSuggestion` 类型：增加自动推进标记
- 实现问题卡片升级机制
- 实现审计轨迹

### P3 — 验证与收尾

- 更新 SOP skill 文档
- 验证与现有 dispatch lock、abort 机制的兼容性

## 非目标

- 不改变 merge 硬门禁——merge 必须由用户控制
- 不引入 AI 风险等级主观判断——自动推进条件必须是客观可检查的
- 不修改 reviewer/developer 的工作流程——只修改 stage transition 的触发机制
- 不处理端到端集成测试中的人类介入（不在 SOP 范围内）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 design stage 中两个架构师达成共识时 | 系统自动推进到 development stage，用户收到摘要通知 | — |
| B2 | 当 design stage 中两个架构师存在分歧时 | 系统生成问题卡片，列出分歧点和双方论点，等待用户选择 | — |
| B3 | 当 development stage 中开发者完成 self-check 且 evidence 齐全时 | 系统自动推进到 review stage | — |
| B4 | 当 review stage 中两个 reviewer 达成"无问题"共识时 | 系统自动推进到 merge 前置检查，但 **不执行 merge** | — |
| B5 | 当 review 阶段的"发现→修复→验证"循环超过 2 轮时 | 系统通知用户介入，附带完整循环历史 | — |
| B6 | 当 merge 硬条件全部通过时 | 系统呈现"合入就绪"状态，等待用户显式执行合入 | — |
| B7 | 当自动推进触发时 | 系统记录审计轨迹：推进时间、触发条件、对抗共识/分歧内容 | — |
| B8 | 当用户需要回退自动推进的 stage 时 | 系统支持回退到上一个 stage | — |
| B9 | 当自动推进过程中系统崩溃时 | 恢复后能正确识别当前 stage 状态，不丢失或重复推进 | — |

## 设计

### 核心概念：系统级自动推进，非 agent 级

**旧认知的移除**：`collaboration.ts` L606 的 system reminder 写死了"永远不要自动推进 Stage"。这是旧设计的产物，反映的是"所有推进都需要人手动"的旧认知。新设计需要修改此约束——将"永远不要自动推进"改为信号协议指引，让 agent 知道如何通过 `consensus`/`disagreement`/`gate_complete` 信号表达阶段工作结果。

**架构分层**：
- **Agent 层**：负责产出信号（共识/分歧/完成），不负责推进决策
- **系统层**：检测信号、验证条件、执行推进、记录审计
- **用户层**：处理分歧决策、控制 merge、回退 stage

这与当前架构一致：当前 agent 发出 `stage_transition` 信号 → 系统检测并存储为 `StageTransitionSuggestion` → 用户手动 advance。本文档只是在"系统检测"和"用户 advance"之间插入"自动判断"逻辑。

### P1 详设：自动推进协议

**Agent 信号协议**：

Agent 在完成阶段工作后，通过消息中的结构化信号表达结果。当前已有 `stage_transition` 信号，扩展为三种信号：

| 信号类型 | 格式 | 含义 |
|---------|------|------|
| `consensus` | `{ "stage_transition": { "target_key": "...", "consensus": true, "reason": "..." } }` | 对抗达成共识，建议推进 |
| `disagreement` | `{ "stage_transition": { "target_key": "...", "consensus": false, "reason": "...", "positions": [...] } }` | 对抗存在分歧，需要用户决策 |
| `gate_complete` | `{ "stage_transition": { "target_key": "...", "consensus": true, "gate_evidence": {...} } }` | Gate 自检完成，evidence 齐全（单人完成，consensus 固定为 true） |

**自动推进条件**（全部为客观可检查条件，无主观风险判断）：

| 阶段转换 | 自动推进条件 | 升级条件 |
|----------|-------------|---------|
| design → development | 收到 `consensus` 信号 + gate evidence 齐全（design-01/02 通过） | 收到 `disagreement` 信号 或 无信号 |
| development → review | 收到 `gate_complete` 信号 + dev-01~06 全部通过 | dev-06 evidence 缺失 |
| review → merge 前置 | 收到 `consensus` 信号（两个 reviewer 都无问题）+ rev-01~03 通过 + review 循环 ≤ 2 轮 | 收到 `disagreement` 信号 或 review 循环 > 2 轮 |
| merge 前置 → merge | **不自动推进**。呈现"合入就绪"状态，等待用户显式执行 | — |

**关于 [Incompatible] 标签的时间悖论**：

第二轮红蓝对抗识别出：[Incompatible] 标签在 design 阶段不存在（代码尚未编写），作为 design→development 的自动推进条件是空条件。

**解决**：[Incompatible] 不作为 design→development 的自动推进条件。它在 development→review 和 review→merge 的条件中生效：如果 PR 标题包含 `[Incompatible]`，则 review→merge 前置的自动推进被阻断，必须等待用户确认。

**[Incompatible] 检查位置**：在 `evaluateAutoAdvance()` 中，consensus 验证通过之后、自动推进之前检查。如果 PR 标题包含 `[Incompatible]`，阻断自动推进，通知用户。

**关于对抗机制**：

design stage 和 review stage 采用对抗机制，需要两个不同 agent 达成共识才能自动推进。

**design stage 对抗机制**：
- 两个架构师角色：`architect-1`（正方）和 `architect-2`（反方）
- 触发方式：用户创建 issue 后，系统自动向两个架构师发送任务
- 协作方式：`architect-1` 先产出设计文档，`architect-2` 对设计文档进行对抗审查
- 共识条件：两个架构师都发出 `consensus: true` 的信号
- 分歧条件：任一架构师发出 `consensus: false` 的信号

**review stage 对抗机制**：
- 两个 reviewer 角色：`reviewer-1`（正方）和 `reviewer-2`（反方）
- 触发方式：development stage 自动推进后，系统自动向两个 reviewer 发送任务
- 协作方式：两个 reviewer 独立审查 PR，各自发出信号
- 共识条件：两个 reviewer 都发出 `consensus: true` 的信号
- 分歧条件：任一 reviewer 发出 `consensus: false` 的信号

**关于 review 循环计数**：

B5 的"2 轮"阈值依据：1 轮是正常的 review-修复-recheck 流程；2 轮说明问题的根因可能未被识别；3 轮以上说明对抗机制本身失效。取 2 轮作为通知阈值（不是阻断阈值——超过 2 轮后仍可继续，只是通知用户关注）。

**`review_round` 递增逻辑**：
- 触发条件：reviewer 发出 `consensus: false` 的信号（即提出新问题）
- 更新方式：`evaluateAutoAdvance()` 在检测到 `disagreement` 信号时，递增 `review_round` 计数
- 存储位置：在 `StageTransitionSuggestion` 中增加 `review_round` 字段
- 通知条件：当 `review_round > 2` 时，触发用户通知

**关于分歧处理流程**：

用户通过问题卡片选择某个 position 后，系统需要：
1. 将用户选择记录到审计轨迹
2. 通知相关 agent 用户的选择
3. agent 根据用户选择继续工作（修复问题或调整设计）
4. 重新进入自动推进评估流程

**关于手动 advance 语义**：

用户手动调用 `advanceStage()` 时，直接绕过自动推进条件。原因：
- 用户有最终决策权
- 自动推进是辅助机制，不能阻止用户操作
- 用户可能基于自动推进系统无法感知的外部信息做决策

**关于关联失败（correlated failure）风险**：

两个 agent 共享 LLM、prompt 模板、SOP 规则和 codebase 上下文，"独立判断"的前提不完全成立。

**缓解措施**（非消除，承认风险存在）：
1. **对抗结构本身提供信息增益**——即使共享上下文，"找问题"和"辩护"的对抗角色指令强制 agent 从不同角度分析
2. **merge 作为最终防线**——关联失败的最坏情况是"两个 agent 都没发现问题"，但 merge 硬门禁确保用户在代码进入 main 前有最后审查机会
3. **审计轨迹可追溯**——自动推进的决策依据被记录，用户可以在 merge 时回溯检查

**诚实声明**：自动推进不等于"已验证"。它等于"两个 agent 在对抗模式下未发现问题"。这比单人审批强（对抗提供了信息增益），但比人类深审弱（关联失败风险始终存在）。

### P2 详设：实现

**修改 `collaboration.ts`**：

当前流程：
```
agent 发出 stage_transition 信号
  → detectStageTransition() 提取并存储为 StageTransitionSuggestion
  → notifyConsumers("onStageTransitionSuggested")
  → 用户手动调用 advanceStage()
```

新流程：
```
agent 发出 consensus/disagreement/gate_complete 信号
  → detectStageTransition() 提取并存储
  → evaluateAutoAdvance() 检查自动推进条件
    → 条件满足 + 非 merge：自动调用 advanceStage() + 记录审计
    → 条件满足 + merge 前置：呈现"合入就绪"状态
    → 收到 disagreement：生成问题卡片升级用户
    → 条件不满足：等待
```

**`extractStageTransitionSuggestion()` 方法更新**：

需要更新现有方法以提取新增字段（`consensus`、`positions`、`gate_evidence`）：

```typescript
private extractStageTransitionSuggestion(stage: Stage, roleInstance: string, messageId: number): StageTransitionSuggestion | null {
  for (const event of this.deps.messagePort.getMessageEvents(messageId)) {
    if (event.payload.type === "signal" && typeof event.payload.stage_transition === "object" && event.payload.stage_transition) {
      const payload = event.payload.stage_transition as Record<string, unknown>;
      const targetKey = String(payload.target_key ?? payload.to ?? "");
      if (!targetKey || !stage.available_transitions.some(transition => transition.to === targetKey)) continue;
      return this.makeStageTransitionSuggestion({
        stage, roleInstance, messageId, targetKey,
        reason: payload.reason,
        guard: payload.guard,
        consensus: typeof payload.consensus === "boolean" ? payload.consensus : undefined,
        positions: Array.isArray(payload.positions) ? payload.positions as Position[] : undefined,
        gate_evidence: typeof payload.gate_evidence === "object" ? payload.gate_evidence as Record<string, unknown> : undefined
      });
    }

    if (event.payload.type === "text") {
      const parsed = this.tryParseStageTransition(event.payload.text);
      if (parsed?.target_key && stage.available_transitions.some(transition => transition.to === parsed.target_key)) {
        return this.makeStageTransitionSuggestion({
          stage, roleInstance, messageId, targetKey: parsed.target_key,
          reason: parsed.reason,
          guard: parsed.guard,
          consensus: typeof parsed.consensus === "boolean" ? parsed.consensus : undefined,
          positions: Array.isArray(parsed.positions) ? parsed.positions as Position[] : undefined,
          gate_evidence: typeof parsed.gate_evidence === "object" ? parsed.gate_evidence as Record<string, unknown> : undefined
        });
      }
    }
  }
  return null;
}
```

**`makeStageTransitionSuggestion()` 方法更新**：

需要更新 helper 方法以接受并存储新增字段：

```typescript
private makeStageTransitionSuggestion(params: {
  stage: Stage;
  roleInstance: string;
  messageId: number;
  targetKey: string;
  reason: unknown;
  guard: unknown;
  consensus?: boolean;
  positions?: Position[];
  gate_evidence?: Record<string, unknown>;
}): StageTransitionSuggestion {
  return {
    stage_id: params.stage.id,
    message_id: params.messageId,
    from_speaker: params.roleInstance,
    target_key: params.targetKey,
    reason: String(params.reason ?? ""),
    guard: typeof params.guard === "string" ? params.guard : null,
    artifacts: { ...params.stage.output_artifacts },
    created_at: new Date().toISOString(),
    // 新增字段
    consensus: params.consensus,
    positions: params.positions,
    gate_evidence: params.gate_evidence
  };
}
```

**`Position` 和 `StageAuditRecord` 接口定义位置**：

这两个接口应在 `port.ts` 中定义并导出，供 `collaboration.ts` 使用：

**`evaluateAutoAdvance()` 逻辑**：

```typescript
private async evaluateAutoAdvance(stage: Stage): Promise<void> {
  const suggestions = this.suggestions.get(stage.id) ?? [];
  if (suggestions.length === 0) return;

  // merge 阶段不自动推进
  if (stage.available_transitions.some(t => t.to === "merge")) {
    await this.notifyConsumers(stage.id, "onMergeReady", { suggestions });
    return;
  }

  // 检查是否有分歧信号
  const disagreement = suggestions.find(s => s.consensus === false);
  if (disagreement) {
    await this.notifyConsumers(stage.id, "onDisagreement", disagreement);
    return;
  }

  // development stage：单人完成，只需 gate_complete 信号
  if (stage.key === "development") {
    const gateComplete = suggestions.find(s => s.consensus === undefined && s.gate_evidence);
    if (!gateComplete) return;
    if (this.allGatesPassed(stage, gateComplete)) {
      const targetKey = gateComplete.target_key;
      const newStage = this.advanceStage(stage.id, targetKey);
      this.suggestions.delete(stage.id);
      await this.recordAuditTrail(stage, newStage, gateComplete);
      await this.notifyConsumers(stage.id, "onAutoAdvanced", {
        from: stage.key, to: newStage.key, reason: gateComplete.reason
      });
    }
    return;
  }

  // design/review stage：对抗机制，需要两个不同 agent 的共识
  const consensusSignals = suggestions.filter(s => s.consensus === true);
  const uniqueSpeakers = new Set(consensusSignals.map(s => s.from_speaker));
  if (uniqueSpeakers.size < 2) return; // 单个 agent 的共识不足以触发自动推进

  // gate 证据验证
  const latest = consensusSignals[consensusSignals.length - 1];
  if (this.allGatesPassed(stage, latest)) {
    const targetKey = latest.target_key;
    const newStage = this.advanceStage(stage.id, targetKey);
    this.suggestions.delete(stage.id);
    await this.recordAuditTrail(stage, newStage, latest);
    await this.notifyConsumers(stage.id, "onAutoAdvanced", {
      from: stage.key, to: newStage.key, reason: latest.reason
    });
  }
}
```

**`StageTransitionSuggestion` 类型扩展**：

```typescript
interface Position {
  speaker: string;          // 角色实例名称
  stance: "for" | "against" | "neutral";
  argument: string;         // 论点摘要
  evidence?: string;        // 支撑证据
}

interface StageTransitionSuggestion {
  // ... 现有字段
  consensus?: boolean;      // true=共识, false=分歧, undefined=gate_complete（单人完成）
  positions?: Position[];   // 分歧时各方论点
  review_round?: number;    // review 循环轮次
  gate_evidence?: Record<string, unknown>; // gate 自检证据
}
```

**`allGatesPassed()` 方法**：

```typescript
private allGatesPassed(stage: Stage, suggestion: StageTransitionSuggestion): boolean {
  // 按阶段检查具体的 gate item
  const stageKey = stage.key;
  const gateEvidence = suggestion.gate_evidence ?? {};

  switch (stageKey) {
    case "design":
      return this.checkDesignGates(gateEvidence);
    case "development":
      return this.checkDevGates(gateEvidence);
    case "review":
      return this.checkReviewGates(gateEvidence);
    default:
      return false;
  }
}

private checkDesignGates(evidence: Record<string, unknown>): boolean {
  // design-01: feature doc 已锁定
  // design-02: 无未解决的分歧
  const design01 = evidence["design-01"];
  const design02 = evidence["design-02"];
  return typeof design01 === "string" && design01.trim().length > 0 &&
         typeof design02 === "string" && design02.trim().length > 0;
}

private checkDevGates(evidence: Record<string, unknown>): boolean {
  // dev-01: 代码已实现
  // dev-02: 自检通过
  // dev-03: feature doc 已更新
  // dev-04: PR 已创建
  // dev-06: 变更完整性已验证
  const requiredGates = ["dev-01", "dev-02", "dev-03", "dev-04", "dev-06"];
  return requiredGates.every(gate => {
    const value = evidence[gate];
    return typeof value === "string" && value.trim().length > 0;
  });
}

private checkReviewGates(evidence: Record<string, unknown>): boolean {
  // rev-01: 所有 review 评论已处理
  // rev-02: 独立验证命令已执行
  // rev-03: PR 评论已签名
  const requiredGates = ["rev-01", "rev-02", "rev-03"];
  return requiredGates.every(gate => {
    const value = evidence[gate];
    return typeof value === "string" && value.trim().length > 0;
  });
}
```

**`recordAuditTrail()` 方法**：

```typescript
private async recordAuditTrail(fromStage: Stage, toStage: Stage, suggestion: StageTransitionSuggestion): Promise<void> {
  const audit = {
    stage_id: fromStage.id,
    from_key: fromStage.key,
    to_key: toStage.key,
    trigger: "auto",
    trigger_reason: suggestion.reason,
    consensus_content: suggestion.guard ?? "",
    timestamp: Date.now()
  };
  await this.deps.stagePort.recordAudit(audit);
}
```

**`CollaborationConsumer` 接口扩展**：

```typescript
export interface CollaborationConsumer {
  // ... 现有回调
  onStageTransitionSuggested?(stageId: string, suggestion: StageTransitionSuggestion): void | Promise<void>;

  // 新增回调
  onMergeReady?(stageId: string, data: { suggestions: StageTransitionSuggestion[] }): void | Promise<void>;
  onDisagreement?(stageId: string, suggestion: StageTransitionSuggestion): void | Promise<void>;
  onAutoAdvanced?(stageId: string, data: { from: string; to: string; reason: string }): void | Promise<void>;
}
```

**`CollaborationInput` 接口扩展**：

```typescript
export interface CollaborationInput {
  // ... 现有方法
  advanceStage(stageId: string, targetKey: string): Promise<Stage>;

  // 新增方法
  rollbackStage(stageId: string, targetKey: string): Promise<Stage>;
  getStageAuditTrail(stageId: string): Promise<StageAuditRecord[]>;
  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[];
}

interface StageAuditRecord {
  stage_id: string;
  from_key: string;
  to_key: string;
  trigger: "auto" | "manual";
  trigger_reason: string;
  consensus_content: string;
  timestamp: number;
}
```

**`StagePort` 接口扩展**：

```typescript
export interface StagePort {
  // ... 现有方法
  advanceStage(stageId: string, targetKey: string): Stage;

  // 新增方法
  rollbackStage(stageId: string, targetKey: string): Stage;
  recordAudit(audit: StageAuditRecord): Promise<void>;
  getAuditTrail(stageId: string): Promise<StageAuditRecord[]>;
}
```

**问题卡片生成**：

收到 `disagreement` 信号时，复用 `message-payload` 的 `question` 子命令生成问题卡片：

```typescript
private async generateDisagreementCard(stageId: string, suggestion: StageTransitionSuggestion): Promise<void> {
  const positions = suggestion.positions ?? [];
  const options = positions.map(p => ({
    label: `${p.speaker}: ${p.stance}`,
    description: p.argument
  }));

  await this.notifyConsumers(stageId, "onDisagreement", {
    ...suggestion,
    question: {
      text: suggestion.reason,
      options
    }
  });
}
```

**审计轨迹**：

新增 `stage_audit` 数据库表（或在现有 stage 表中增加 JSON 字段）：

| 字段 | 类型 | 说明 |
|------|------|------|
| stage_id | string | 阶段 ID |
| from_key | string | 转换前阶段 |
| to_key | string | 转换后阶段 |
| trigger | string | "auto" 或 "manual" |
| trigger_reason | string | 对抗共识/分歧原因 |
| consensus_content | string | 共识内容摘要 |
| timestamp | number | 时间戳 |

**回滚机制**：

当前 `advanceStage()` 是单向的（L138-143：推进 + 清理 dispatch 状态）。需要新增 `rollbackStage()` 方法：

```typescript
async rollbackStage(stageId: string, targetKey: string): Promise<Stage> {
  // 回退到指定 stage，保留当前 stage 的消息历史
  const stage = this.deps.stagePort.rollbackStage(stageId, targetKey);
  this.cleanupDispatchStates(stageId);
  this.suggestions.delete(stageId); // 清理信号，防止回滚后重新触发自动推进
  this.initStageCursors(stage);
  return stage;
}
```

回退的约束：
- 只能回退到当前 stage 的前一个 stage（不能跳级回退）
- 回退保留所有消息历史（不删除已产出的内容）
- 回退后需要重新走该 stage 的完整流程

**崩溃恢复**：

`evaluateAutoAdvance()` 需要是幂等的：
- 如果 `advanceStage` 成功但 `notifyConsumers` 失败，恢复后重新通知
- 如果 `advanceStage` 本身失败（stage 已被推进），静默跳过
- 在 issue 初始化时（`initStageCursors`），检查是否有未完成的自动推进

### 设计决策

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 |
|---|-------|---------|---------|---------|---------|
| D1 | 自动推进执行主体 | 系统代码更可控 | 需要修改核心引擎 | 系统代码执行，不经过 agent | L606 是旧认知，需要修改为信号协议指引；系统代码执行推进 |
| D2 | 共识信号格式 | agent 自由表达 | 格式不统一，系统难以解析 | 结构化 JSON 信号（扩展已有 `stage_transition` 格式） | 已有信号提取机制，扩展而非重建 |
| D3 | 风险等级判断 | 精细化控制 | 主观判断不可靠 | 不引入风险等级；用客观条件（共识/分歧/evidence）替代 | 第二轮红蓝对抗 #5：无自动分类机制 |
| D4 | [Incompatible] 处理 | design 阶段阻断 | design 阶段无此标签 | 仅在 review→merge 阶段生效 | 第二轮红蓝对抗 #4：时间悖论 |
| D5 | Review 循环阈值 | 1 轮太严，3 轮太松 | 无科学依据 | 2 轮通知（不阻断），可配置 | 经验值 + 用户可调整 |
| D6 | 回滚机制 | 用户需要纠错能力 | 增加复杂度 | 支持单级回退，保留消息历史 | 自动推进可能误触发，需要撤销能力 |
| D7 | Merge 自动化 | 效率 | 不可逆风险 | 不自动 merge；呈现就绪状态等用户执行 | 用户明确要求：merge 必须控制在手 |
| D8 | 问题卡片格式 | 结构化论点 | 用户需理解格式 | 复用已有 `message-payload` question 子命令 | 已有机制，不重建 |

<!-- [design-time] 章节结束 -->

## 生效路径

| 入口 | 内容 |
|------|------|
| `src/app/issue-collaboration/collaboration.ts` | 自动推进逻辑、回滚机制、审计轨迹 |
| `data/file/skills/cd-design/SKILL.md` | 架构师信号协议（共识/分歧） |
| `data/file/skills/cd-review/SKILL.md` | Reviewer 信号协议（共识/分歧） |
| `data/file/skills/cd-development/SKILL.md` | 开发者 gate_complete 信号协议 |
| `data/file/skills/cd-merge/SKILL.md` | Merge 就绪状态呈现 |
| `data/file/skills/cd-shared/references/stage-gate.md` | 自动推进条件表 |

## 设计约束摘要

- **边界**：自动推进由系统代码执行，不经过 agent 决策；agent 只产出信号
- **旧认知移除**：L606 "永远不要自动推进 Stage" 需要修改为信号协议指引
- **关键决策**：merge 不自动推进；无主观风险等级判断；支持单级回退
- **非目标约束**：不修改 reviewer/developer 工作流程；不引入 AI 风险等级
- **语义不变量**：merge 执行权始终在用户手中；自动推进 ≠ 已验证

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `docs/features/2026/06/26/F20260626m4vx-human-intervention-auto-advance.md` | 新增 | 本文档 |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | 添加 `evaluateAutoAdvance()`、`rollbackStage()`、`allGatesPassed()`、`checkDesignGates()`、`checkDevGates()`、`checkReviewGates()`、`recordAuditTrail()`、`generateDisagreementCard()`；更新 `extractStageTransitionSuggestion()`、`makeStageTransitionSuggestion()`；修改 L606 system reminder |
| `src/app/issue-collaboration/port.ts` | 修改 | `StageTransitionSuggestion` 类型扩展、`CollaborationConsumer` 接口扩展（新增 `onMergeReady`/`onDisagreement`/`onAutoAdvanced` 回调）、`CollaborationInput` 接口扩展（新增 `rollbackStage`/`getStageAuditTrail` 方法）、`StagePort` 接口扩展（新增 `rollbackStage`/`recordAudit`/`getAuditTrail` 方法） |
| `data/file/skills/cd-design/SKILL.md` | 修改 | 架构师信号协议 |
| `data/file/skills/cd-review/SKILL.md` | 修改 | Reviewer 信号协议 |
| `data/file/skills/cd-development/SKILL.md` | 修改 | 开发者 gate_complete 信号 |
| `data/file/skills/cd-merge/SKILL.md` | 修改 | Merge 就绪状态 |
| `data/file/skills/cd-shared/references/stage-gate.md` | 修改 | 自动推进条件表 |

## 验证

### P1

- [ ] Agent 信号协议定义完成（consensus/disagreement/gate_complete）
- [ ] 自动推进条件表客观可检查（无主观判断）
- [ ] System reminder 更新：从"永远不要自动推进"改为信号协议指引

### P2

- [ ] `evaluateAutoAdvance()` 实现：consensus + gate → 自动推进（design/review stage）
- [ ] `evaluateAutoAdvance()` 实现：gate_complete + gate → 自动推进（development stage）
- [ ] `evaluateAutoAdvance()` 实现：disagreement → 问题卡片升级
- [ ] `evaluateAutoAdvance()` 实现：merge 前置 → 就绪状态（不自动 merge）
- [ ] `evaluateAutoAdvance()` 实现：共识信号来源验证——必须有至少两个不同 `from_speaker` 的 consensus 信号（design/review stage）
- [ ] `evaluateAutoAdvance()` 实现：gate 证据验证——按阶段检查具体 gate item
- [ ] `evaluateAutoAdvance()` 实现：`[Incompatible]` 检查——阻断自动推进并通知用户
- [ ] `allGatesPassed()` 实现：按阶段调用 `checkDesignGates()`/`checkDevGates()`/`checkReviewGates()`
- [ ] `checkDesignGates()` 实现：验证 design-01/02
- [ ] `checkDevGates()` 实现：验证 dev-01~06
- [ ] `checkReviewGates()` 实现：验证 rev-01~03
- [ ] `recordAuditTrail()` 实现：写入 stage_audit 记录
- [ ] `generateDisagreementCard()` 实现：复用 message-payload question 子命令
- [ ] 分歧处理流程：用户选择 position 后通知 agent 继续工作
- [ ] `review_round` 递增逻辑：检测到 disagreement 时递增
- [ ] `extractStageTransitionSuggestion()` 更新：提取 consensus、positions、gate_evidence 字段
- [ ] `makeStageTransitionSuggestion()` 更新：接受并存储新增字段
- [ ] `rollbackStage()` 实现：单级回退 + 保留消息历史 + 清理 signals 防止重新触发
- [ ] `Position` 接口定义：在 port.ts 中导出
- [ ] `StageAuditRecord` 接口定义：在 port.ts 中导出
- [ ] `CollaborationConsumer` 接口扩展：新增 `onMergeReady`/`onDisagreement`/`onAutoAdvanced` 回调
- [ ] `CollaborationInput` 接口扩展：新增 `rollbackStage`/`getStageAuditTrail` 方法
- [ ] `StagePort` 接口扩展：新增 `rollbackStage`/`recordAudit`/`getAuditTrail` 方法
- [ ] 手动 advance 语义：直接绕过自动推进条件
- [ ] 审计轨迹记录：每次自动推进有完整记录
- [ ] 崩溃恢复：`evaluateAutoAdvance()` 幂等
- [ ] review 循环计数：超过 2 轮触发用户通知
- [ ] [Incompatible] 标签：仅在 review→merge 阶段阻断自动推进
- [ ] 与现有 dispatch lock 机制兼容
- [ ] 与现有 abort 机制兼容

### P3

- [ ] 所有 SOP skill 文档更新
- [ ] stage-gate.md 包含自动推进条件表

### 通用

- [ ] 第二轮红蓝对抗 P3 相关攻击点全部回应
- [ ] 第三轮红蓝对抗攻击点全部回应（#11-#14）
- [ ] 第四轮红蓝对抗攻击点全部回应（#15-#22）
- [ ] 与 F20260626g7rt（测试机制设计）兼容
- [ ] 与 F20260626v7s5（stage gate 强制执行）兼容
- [ ] `npm run check` 编译通过

## 关联

- **前置**: F20260626g7rt（测试机制设计）— 本文档从中拆分而来
- **前置**: F20260626v7s5（Stage Gate 强制执行）— 本文档在此基础上增加自动推进机制
- **相关**: F2026060701（行为契约测试范式）— 测试失败决策树中的"升级到架构师讨论"与本文档的分歧升级机制相关

## 分析推理过程记录

### 从 F20260626g7rt 拆分的决策过程

F20260626g7rt 的第二轮红蓝对抗识别出：
1. P3 修改 `collaboration.ts` 核心引擎，P1/P2 不需要——风险不匹配
2. P3 的验证标准（自动推进、回滚、审计）与 P1/P2（断言约束、Vitest 配置）完全独立
3. 捆绑会导致 P3 的 bug 阻塞测试基础设施合入

因此 P3 拆分为独立 feature。

### 第二轮红蓝对抗中 P3 相关的攻击与回应

| # | 攻击 | 回应 |
|---|------|------|
| #3 | auto-advance vs "永远不要自动推进 Stage"（L606） | 区分 agent 级（禁止）和系统级（本文档实现）；修改 system reminder 为信号协议指引 |
| #4 | [Incompatible] 时间悖论 | 仅在 review→merge 阶段生效；design→dev 不依赖此标签 |
| #5 | 风险分层缺乏可执行机制 | 不引入主观风险等级；用客观条件（共识/分歧/evidence）替代 |
| #6 | 关抗共识关联失败 | 承认风险存在；缓解措施：对抗结构提供信息增益 + merge 硬门禁 + 审计可追溯 |
| #7 | "2 轮"依据缺失 | 经验值：1 轮正常，2 轮需关注，3+ 轮说明机制失效；可配置 |
| #9 | 修改核心引擎风险 | 详细设计 evaluateAutoAdvance() 逻辑；与 dispatch lock、abort 机制的兼容性在 P3 验证 |
| #10 | 缺少审计/回滚 | 新增 stage_audit 记录 + rollbackStage() 方法 |

### 第三轮红蓝对抗的攻击与回应

| # | 攻击 | 回应 |
|---|------|------|
| #11 | 共识信号来源不可验证——单个 agent 可伪造 consensus 信号绕过对抗机制 | `evaluateAutoAdvance()` 必须检查是否有至少两个不同 `from_speaker` 的 consensus 信号 |
| #12 | gate_complete 信号自证——agent 自己说"我通过了"就自动推进，gate 形同虚设 | 需要验证 `guard` 字段是否有实质内容（如 PR URL、测试输出），不能只看信号存在 |
| #13 | 多信号并发竞态——两个 reviewer 同时发出信号，后到的覆盖先到的 | 从"只看 latest"改为"检查所有 suggestions 中是否有共识" |
| #14 | 回滚后自动推进会重新触发——旧信号还在内存中 | `rollbackStage()` 必须清理该 stage 的所有 `StageTransitionSuggestion` |

### 第四轮红蓝对抗的攻击与回应（完整性）

| # | 攻击 | 回应 |
|---|------|------|
| #15 | `gate_complete` 信号与 `consensus` 字段矛盾——development stage 只有一个开发者，不存在"两个 agent 达成共识"的场景 | `consensus` 改为可选字段；`gate_complete` 信号的 `consensus` 固定为 true；`evaluateAutoAdvance()` 对 development stage 单独处理 |
| #16 | `allGatesPassed()` 未按阶段检查具体 gate item——guard 字段有内容不代表 gate 通过 | 按阶段调用 `checkDesignGates()`/`checkDevGates()`/`checkReviewGates()`，验证具体的 gate item |
| #17 | 设计/开发/审查阶段的对抗机制未定义——两个架构师/两个 reviewer 如何触发和协作 | 定义对抗机制：design stage 有 `architect-1` 和 `architect-2`；review stage 有 `reviewer-1` 和 `reviewer-2` |
| #18 | 用户选择分歧方案后的处理流程未定义 | 用户选择 position 后，系统记录选择、通知 agent、agent 继续工作、重新进入自动推进评估 |
| #19 | `review_round` 递增的触发条件未定义 | 检测到 `disagreement` 信号时递增，由 `evaluateAutoAdvance()` 负责更新 |
| #20 | 自动推进通知的内容未定义 | `onAutoAdvanced` 通知应包含 from/to 阶段、触发原因、审计轨迹 ID |
| #21 | `[Incompatible]` 检查的执行位置未定义 | 在 `evaluateAutoAdvance()` 中，consensus 验证通过之后、自动推进之前检查 |
| #22 | 手动 advance 与自动 advance 的关系未定义 | 手动 advance 直接绕过自动推进条件，用户有最终决策权 |

### 关键设计洞察

1. **Agent 级 vs 系统级的分界**：当前 L606 "永远不要自动推进" 是对 agent 的约束。自动推进由系统代码执行，不违反此约束。但需要修改 system reminder，让 agent 知道如何通过信号表达共识/分歧。

2. **客观条件 vs 主观判断**：第二轮红蓝对抗的核心教训是"风险等级无法自动判断"。因此自动推进条件全部是客观可检查的：信号类型（consensus/disagreement）、evidence 完整性、循环计数、标签存在性。

3. **Merge 的不可逆性**：这是整个设计的锚点。所有自动推进的终点都是"merge 前置"而非"merge"。用户在 merge 前有最后的审查机会。

4. **回滚作为安全网**：自动推进可能误触发（关联失败、信号误解析）。回滚机制确保用户可以纠正错误，而不是被迫接受。

5. **信号来源验证**：第三轮红蓝对抗的核心教训是"单个 agent 可以伪造共识信号"。因此 `evaluateAutoAdvance()` 必须验证信号来源——检查是否有至少两个不同 `from_speaker` 的共识信号，而不是只看 `latest`。

6. **Gate 证据自证问题**：agent 自己说"我通过了"不能作为自动推进的依据。需要验证 `guard` 字段是否有实质内容（如 PR URL、测试输出），而不是空值或模板化文本。

7. **并发信号处理**：多个 agent 可能同时发出信号，系统需要等待所有预期角色的信号都到达后再评估，而不是只看最后一条。

8. **阶段差异化处理**：第四轮红蓝对抗的核心教训是"不同阶段有不同的信号语义"。development stage 只有一个开发者，使用 `gate_complete` 信号；design/review stage 有对抗机制，使用 `consensus` 信号。`evaluateAutoAdvance()` 需要按阶段分别处理。

9. **Gate 检查的具体化**：不能只检查 guard/evidence 的非空性，需要按阶段验证具体的 gate item（design-01/02、dev-01~06、rev-01~03）。

10. **对抗机制的形式化**：需要明确定义两个架构师/两个 reviewer 的角色、触发方式和协作流程，而不是假设它们存在。

11. **分歧处理的闭环**：用户选择 position 后需要有完整的处理流程，而不是只展示问题卡片。

12. **手动 advance 的优先级**：用户手动 advance 应该直接绕过自动推进条件，因为用户有最终决策权。

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|-------|---------|---------|---------|---------|--------|------|
| D1 | 自动推进执行主体 | 系统代码可控 | 需改核心引擎 | 系统代码 | L606 对 agent 的约束不适用于系统代码 | 第二轮红蓝 #3 | 2026-06-26 |
| D2 | 风险等级判断 | 精细化控制 | 无自动分类机制 | 不引入；用客观条件替代 | 第二轮红蓝 #5 | 红队 | 2026-06-26 |
| D3 | [Incompatible] 处理 | design 阶段阻断 | 时间悖论 | 仅 review→merge 生效 | 第二轮红蓝 #4 | 红队 | 2026-06-26 |
| D4 | Review 循环阈值 | 需要阈值 | 无科学依据 | 2 轮通知，可配置 | 经验值 | 分析推导 | 2026-06-26 |
| D5 | Merge 自动化 | 效率 | 不可逆 | 不自动 | 用户明确要求 | 用户 | 2026-06-26 |
| D6 | 回滚机制 | 纠错能力 | 增加复杂度 | 支持单级回退 | 自动推进可能误触发 | 第二轮红蓝 #10 | 2026-06-26 |
| D7 | 共识信号来源验证 | 防止单 agent 伪造 | 增加复杂度 | 必须有至少两个不同 from_speaker 的 consensus 信号 | 第三轮红蓝 #11：单个 agent 可伪造共识 | 红队 | 2026-06-26 |
| D8 | Gate 证据验证 | 防止自证通过 | 增加验证逻辑 | guard 字段必须有实质内容 | 第三轮红蓝 #12：agent 自己说"我通过了"不能作为依据 | 红队 | 2026-06-26 |
| D9 | 并发信号处理 | 避免竞态 | 增加复杂度 | 检查所有 suggestions 而非只看 latest | 第三轮红蓝 #13：后到的信号覆盖先到的 | 红队 | 2026-06-26 |
| D10 | 回滚清理信号 | 防止重新触发 | 无 | rollbackStage() 清理所有 suggestions | 第三轮红蓝 #14：回滚后旧信号会重新触发 | 红队 | 2026-06-26 |
| D11 | consensus 字段可选性 | gate_complete 不适用 | 增加类型复杂度 | consensus 改为可选字段 | 第四轮红蓝 #15：development stage 只有一个开发者 | 红队 | 2026-06-26 |
| D12 | Gate 检查具体化 | 防止形式化通过 | 增加实现复杂度 | 按阶段调用 checkDesignGates/checkDevGates/checkReviewGates | 第四轮红蓝 #16：guard 有内容不代表 gate 通过 | 红队 | 2026-06-26 |
| D13 | 对抗机制形式化 | 明确触发和协作 | 增加文档篇幅 | 定义 architect-1/2 和 reviewer-1/2 的角色和流程 | 第四轮红蓝 #17：对抗机制未定义 | 红队 | 2026-06-26 |
| D14 | 分歧处理闭环 | 用户选择后有处理 | 增加实现复杂度 | 记录选择、通知 agent、继续工作、重新评估 | 第四轮红蓝 #18：分歧处理流程未定义 | 红队 | 2026-06-26 |
| D15 | 手动 advance 优先级 | 用户有最终决策权 | 无 | 手动 advance 直接绕过自动推进条件 | 第四轮红蓝 #22：手动 advance 关系未定义 | 红队 | 2026-06-26 |

## 范围变更记录

| # | 变更类型 | 变更内容 | 原因 | 日期 |
|---|----------|----------|------|------|
| 1 | 拆分 | 从 F20260626g7rt 拆分为独立 feature | 第二轮红蓝对抗 #11：实现层面独立，捆绑阻塞 | 2026-06-26 |
| 2 | 设计修正 | `evaluateAutoAdvance()` 增加信号来源验证 | 第三轮红蓝 #11：单个 agent 可伪造共识 | 2026-06-26 |
| 3 | 设计修正 | `evaluateAutoAdvance()` 增加 gate 证据验证 | 第三轮红蓝 #12：agent 自证通过不能作为依据 | 2026-06-26 |
| 4 | 设计修正 | 并发信号处理从"只看 latest"改为"检查所有 suggestions" | 第三轮红蓝 #13：后到的信号覆盖先到的 | 2026-06-26 |
| 5 | 设计修正 | `rollbackStage()` 增加清理 suggestions 逻辑 | 第三轮红蓝 #14：回滚后旧信号会重新触发 | 2026-06-26 |
| 6 | 设计修正 | `consensus` 字段改为可选 | 第四轮红蓝 #15：development stage 只有一个开发者 | 2026-06-26 |
| 7 | 设计修正 | `allGatesPassed()` 按阶段检查具体 gate item | 第四轮红蓝 #16：guard 有内容不代表 gate 通过 | 2026-06-26 |
| 8 | 设计修正 | 定义对抗机制（architect-1/2、reviewer-1/2） | 第四轮红蓝 #17：对抗机制未定义 | 2026-06-26 |
| 9 | 设计修正 | 定义分歧处理流程 | 第四轮红蓝 #18：分歧处理流程未定义 | 2026-06-26 |
| 10 | 设计修正 | 定义 `review_round` 递增逻辑 | 第四轮红蓝 #19：递增触发条件未定义 | 2026-06-26 |
| 11 | 设计修正 | 定义 `[Incompatible]` 检查位置 | 第四轮红蓝 #21：检查执行位置未定义 | 2026-06-26 |
| 12 | 设计修正 | 定义手动 advance 语义 | 第四轮红蓝 #22：手动 advance 关系未定义 | 2026-06-26 |
