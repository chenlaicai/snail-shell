---
id: F20260701i7jp
title: auto-advance-config-declarative
from_ids: [F20260629v7k7, F20260626m4vx, F20260630uyj5, F20260630ww93, F20260701tj92]
tags: [sop, auto-advance, open-closed, declarative]
modules: [sop, issue, collaboration]
doc_kind: spec
---

# F20260701i7jp [sop] AutoAdvanceEngine 配置声明式化：消除全部 stage 硬编码

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

`AutoAdvanceEngine`（`src/app/issue-collaboration/auto-advance.ts`）是通用编排引擎 `IssueCollaboration` 的组成部分，所有 SOP 共用。但引擎中散布了 **8 处 `stage.key` 判断**，将 code-delivery SOP 的 stage 特有知识内嵌到通用引擎中：

| # | 位置 | 代码 | 硬编码内容 |
|---|------|------|-----------|
| 1 | L44 | `stage.key === "development"` | gate_complete 信号仅路由到 development |
| 2 | L63 | `stageKey === "design" \|\| stageKey === "review"` | adversarial_consensus 推断条件 |
| 3 | L169-173 | `REQUIRED_CONTEXT_FIELDS[stage.key]` | 各 stage 的必填 context 字段 |
| 4 | L188 | `stage.key !== "review"` | incompatible_tag 阻断仅限 review |
| 5 | L210-217 | `getFailedGates` switch | 各 stage 的 gate ID 列表 |
| 6 | L278 | `stage.key === "design" ? "R4" : "R5"` | 对抗产物校验规则标记 |
| 7 | L289 | `stage.key === "review"` | R8 unresolved findings 阻断仅限 review |
| 8 | L322-327 | `validateStageSpecificFields` 中 stage.key | artifact 结构校验分支 |

当前系统有 4 个 SOP（code-delivery、code-review、evolution、general-assistant），但只有 code-delivery 的 stage 被硬编码在引擎中。新增 SOP 或修改 stage 时必须改通用引擎代码。

### 历史脉络

| 时间 | Feature | 做了什么 | 遗留问题 |
|------|---------|---------|---------|
| 06-26 | F20260626m4vx | 创建 AutoAdvanceEngine | 全部硬编码 |
| 06-29 | F20260629v7k7 | 建立 context enforcement，定义 required fields | required fields 硬编码在引擎中 |
| 06-30 | F20260630uyj5 | 重构为 signal_type 路由、EvaluationResult | 路由逻辑仍按 stage.key 分支 |
| 06-30 | F20260630ww93 | R8 unresolved findings 检查 | R8 硬编码 stage.key === "review" |
| 07-01 | F20260701tj92 | rev-04 gate 校验 | gate ID 硬编码在引擎中 |

## 目标

将 AutoAdvanceEngine 的全部 stage 特有行为从引擎硬编码迁移到 SOP 声明式配置，使：
- SOP YAML 声明每个 stage 的完整自动推进行为（context 校验、gate 校验、信号路由、阻断规则）
- 引擎完全配置驱动，不包含任何 `stage.key` 判断
- 新增 SOP 或修改 stage 时只改 YAML，不改引擎代码

### 非目标

- **不改变 R1-R3/R6-R8 的通用校验逻辑**——这些规则对所有 stage 通用，不需要配置化
- **不改变 R4/R5 的 artifact 结构校验语义**——通过 artifact 字段存在性自动推断类型，消除 `stage.key` 依赖，但校验规则本身不变
- **不改变 context key 命名策略**——保持 F20260629v7k7 的无前缀策略
- **不修改 `set_context` MCP 工具**——F2026062310 已完成
- **不清理 `inferSignalType` 向后兼容推断逻辑**——保留但标记为 deprecated，后续独立清理

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 SOP YAML 声明了 `auto_advance` | `StageDefinition.auto_advance` 应包含完整配置 | |
| B2 | 当 SOP YAML 未声明 `auto_advance` | 该 stage 不参与自动推进 | |
| B3 | 当 AutoAdvanceEngine 评估 stage 推进时 | 应从 `auto_advance` 配置读取所有 stage 特有参数，不使用 `stage.key` | |
| B4 | 当 `required_context_fields` 中的字段缺失时 | 引擎应阻断推进并报告缺失字段 | |
| B5 | 当 `gate_evidence` 中的 gate ID 未通过时 | 引擎应阻断推进并报告失败的 gate | |
| B6 | 当信号类型不在 `accepted_signal_types` 中时 | 引擎应返回 `NO_VALID_SIGNALS` | |
| B7 | 当 `blocking_rules` 中的规则触发时 | 引擎应阻断推进并报告触发的规则 | |
| B8 | 当 `auto_advance` 未声明时 | 引擎返回 `NO_AUTO_ADVANCE_CONFIG`（escalated），不自动推进 | |
| B9 | 当 buildContextBlock 渲染 system reminder 时 | 缺失基础设施警告应基于 `auto_advance.required_context_fields` 而非硬编码列表 | |
| B10 | 当任意 stage 收到 disagreement 信号时 | 引擎应始终处理，不受 `accepted_signal_types` 限制 | |
| B11 | 当 review stage 的 auto_advance 配置完整时 | 引擎走正常 auto-advance 评估（不再硬编码升级到人工） | |

## 设计

### 1. AutoAdvanceConfig 类型定义

**文件**：`src/domain/sop/model.ts`

```typescript
/** 阻断规则类型 */
export type BlockingRuleType = "incompatible_tag" | "unresolved_findings";

/** 阻断规则 */
export interface BlockingRule {
  type: BlockingRuleType;
}

/** stage 自动推进配置 */
export interface AutoAdvanceConfig {
  /** 推进前置：Issue.context 必须存在的 key 列表 */
  required_context_fields: string[];
  /** 推进前置：gate_evidence 必须通过的 gate ID 列表 */
  gate_ids: string[];
  /** 信号路由：本 stage 接受的 signal_type 列表（排他过滤器） */
  accepted_signal_types: string[];
  /** 阻断规则：额外的阻断条件 */
  blocking_rules?: BlockingRule[];
}
```

### 2. StageDefinition 模型扩展

**文件**：`src/domain/sop/model.ts`

```typescript
export interface StageDefinition {
  key: string;
  title: string;
  description: string;
  roles: RoleDefinition[];
  /** 自动推进配置。有值 → 该 stage 参与自动推进；无值 → 不参与 */
  auto_advance?: AutoAdvanceConfig;
}
```

**可选字段**：`auto_advance` 为可选。有值表示该 stage 参与自动推进，无值表示不参与（如 merge、单 stage 终端 SOP）。这不是"向后兼容 shim"，而是显式设计选择——不参与自动推进的 stage 不需要声明配置。

### 3. AutoAdvanceEngine 重写

**文件**：`src/app/issue-collaboration/auto-advance.ts`

**删除**：
- `REQUIRED_CONTEXT_FIELDS` 静态 map（L169-173）
- `getFailedDesignGates` 方法（L220-227）
- `getFailedDevGates` 方法（L229-236）
- `getFailedReviewGates` 方法（L238-252）
- `isIncompatibleBlocked` 方法（L187-196）
- `validateStageSpecificFields` 方法（L311-322）

**修改 `evaluate()`**：移除所有 `stage.key` 判断，改为配置驱动。disagreement 是通用信号，在 `accepted_signal_types` 过滤之前处理（B10）。

```typescript
async evaluate(stage: Stage, suggestions: StageTransitionSuggestion[]): Promise<EvaluationResult> {
  if (suggestions.length === 0) return { action: "blocked", reasons: [{ code: "NO_SIGNALS" }] };

  // 分歧信号优先处理（通用逻辑，所有 stage 都处理，不受 accepted_signal_types 限制）
  const typedSuggestions = suggestions.map(s => ({
    ...s,
    signal_type: s.signal_type ?? this.inferSignalType(s, stage.key),
  }));
  const disagreements = typedSuggestions.filter(s => s.signal_type === "disagreement");
  if (disagreements.length > 0) {
    return await this.handleDisagreement(stage.id, disagreements[disagreements.length - 1]);
  }

  // 无 auto_advance 配置 → 不参与自动推进，升级到人工
  const config = this.getAutoAdvanceConfig(stage);
  if (!config) {
    await this.deps.notifyConsumers(stage.id, "onManualAdvanceRequired", { suggestions });
    return { action: "escalated", reasons: [{ code: "NO_AUTO_ADVANCE_CONFIG" }] };
  }

  // 按 accepted_signal_types 过滤（disagreement 已在上方处理，此处只过滤推进类信号）
  const acceptedSuggestions = typedSuggestions.filter(s =>
    config.accepted_signal_types.includes(s.signal_type!)
  );
  if (acceptedSuggestions.length === 0) {
    return { action: "blocked", reasons: [{ code: "NO_VALID_SIGNALS" }] };
  }

  // 按 signal_type 路由到对应校验链
  const latest = acceptedSuggestions[acceptedSuggestions.length - 1];
  if (latest.signal_type === "gate_complete") {
    return await this.evaluateGateComplete(stage, config, acceptedSuggestions);
  }
  if (latest.signal_type === "adversarial_consensus") {
    return await this.evaluateAdversarialConsensus(stage, config, acceptedSuggestions);
  }

  return { action: "blocked", reasons: [{ code: "NO_VALID_SIGNALS" }] };
}
```

**新增 `getAutoAdvanceConfig`**：从 `Issue.sop_snapshot` 读取配置

```typescript
private getAutoAdvanceConfig(stage: Stage): AutoAdvanceConfig | undefined {
  const issue = this.deps.mustGetIssue(stage.issue_id);
  const stageDef = issue.sop_snapshot.stage_definitions.find(d => d.key === stage.key);
  return stageDef?.auto_advance;
}
```

**修改 `getMissingContextFields`**：从配置读取

```typescript
private getMissingContextFields(stage: Stage, config: AutoAdvanceConfig): string[] {
  if (config.required_context_fields.length === 0) return [];
  const issue = this.deps.mustGetIssue(stage.issue_id);
  return config.required_context_fields.filter(field => !resolveContextValue(issue.context, field));
}
```

**修改 `getFailedGates`**：从配置读取，统一实现

```typescript
private getFailedGates(config: AutoAdvanceConfig, suggestion: StageTransitionSuggestion): string[] {
  const gateEvidence = suggestion.gate_evidence ?? {};
  const failed: string[] = [];
  for (const gate of config.gate_ids) {
    const value = gateEvidence[gate];
    if (typeof value !== "string" || !value.trim()) {
      failed.push(gate);
    }
  }
  return failed;
}
```

**新增 `checkBlockingRules`**：配置驱动的阻断规则

```typescript
private checkBlockingRules(stage: Stage, config: AutoAdvanceConfig): string | null {
  if (!config.blocking_rules) return null;
  const issue = this.deps.mustGetIssue(stage.issue_id);
  for (const rule of config.blocking_rules) {
    if (rule.type === "incompatible_tag") {
      const prTitle = resolveContextValue(issue.context, "pr_title") ?? "";
      if (prTitle.includes("[Incompatible]")) return "INCOMPATIBLE_BLOCKED";
    }
    if (rule.type === "unresolved_findings") {
      // R8: 在 evaluateAdversarialArtifact 中处理（需要 artifact 数据）
    }
  }
  return null;
}
```

**修改 `validateAdversarialArtifact`**：消除 `stage.key` 判断

```typescript
// R4/R5: 通过 artifact 字段存在性自动推断，不依赖 stage.key
validateStageSpecificFields(artifact: AdversarialArtifact): { valid: false; reason: string } | null {
  // R4: 如果 artifact 包含 critique_obligation，校验 items >= 4
  if ("critique_obligation" in artifact && !this.hasDesignFields(artifact)) {
    return { valid: false, reason: "design stage requires critique_obligation.items >= 4" };
  }
  // R5: 如果 artifact 包含 file_coverage，校验 coverage_ratio = 1.0
  if ("file_coverage" in artifact && !this.hasReviewFields(artifact)) {
    return { valid: false, reason: "review stage requires file_coverage.coverage_ratio = 1.0" };
  }
  return null;
}
```

**修改 R8**：从 `blocking_rules` 读取

```typescript
// R8: 通过 config.blocking_rules 判断，不依赖 stage.key
if (config.blocking_rules?.some(r => r.type === "unresolved_findings")) {
  const unresolvedFindings = artifact.adversarial_findings.filter(
    f => f.finding !== "no issues" && (f.disposition === "none" || (f.disposition ?? "").trim() === ""),
  );
  if (unresolvedFindings.length > 0) {
    return { valid: false, reason: `${unresolvedFindings.length} finding(s) with unresolved disposition`, rule: "R8" };
  }
}
```

**修改 `mustGetIssue` 依赖类型**：扩展返回类型以包含 `sop_snapshot`

```typescript
export interface AutoAdvanceDeps {
  // ... existing methods ...
  mustGetIssue(issueId: string): { context: Record<string, string>; sop_snapshot: Sop };
}
```

### 4. SOP YAML 解析与序列化更新

**文件**：`src/domain/sop/_internal/repository.ts`

**解析**：`parseStageDefinition` 读取 `auto_advance`

```typescript
private parseStageDefinition(data: Record<string, unknown>, sopDir: string): StageDefinition {
  // ... existing parsing ...
  return {
    key: data.key as string,
    title: data.title as string,
    description: (data.description as string) ?? "",
    roles,
    auto_advance: data.auto_advance ? this.parseAutoAdvance(data.auto_advance as Record<string, unknown>) : undefined,
  };
}

private parseAutoAdvance(data: Record<string, unknown>): AutoAdvanceConfig {
  return {
    required_context_fields: Array.isArray(data.required_context_fields)
      ? (data.required_context_fields as string[]) : [],
    gate_ids: Array.isArray(data.gate_ids)
      ? (data.gate_ids as string[]) : [],
    accepted_signal_types: Array.isArray(data.accepted_signal_types)
      ? (data.accepted_signal_types as string[]) : [],
    blocking_rules: Array.isArray(data.blocking_rules)
      ? (data.blocking_rules as BlockingRule[]) : undefined,
  };
}
```

**序列化**：`serializeSop` 写入 `auto_advance`

```typescript
const stage: Record<string, unknown> = { key: sd.key, title: sd.title };
if (sd.description != null) stage.description = sd.description;
if (sd.auto_advance) {
  const aa: Record<string, unknown> = {};
  if (sd.auto_advance.required_context_fields.length > 0) aa.required_context_fields = sd.auto_advance.required_context_fields;
  if (sd.auto_advance.gate_ids.length > 0) aa.gate_ids = sd.auto_advance.gate_ids;
  if (sd.auto_advance.accepted_signal_types.length > 0) aa.accepted_signal_types = sd.auto_advance.accepted_signal_types;
  if (sd.auto_advance.blocking_rules && sd.auto_advance.blocking_rules.length > 0) aa.blocking_rules = sd.auto_advance.blocking_rules;
  if (Object.keys(aa).length > 0) stage.auto_advance = aa;
}
```

### 5. code-delivery.yaml 更新

**文件**：`data/file/sops/code-delivery/code-delivery.yaml`

```yaml
stage_definitions:
  - key: design
    title: 需求对齐与设计
    description: |
      两位架构师交叉审视需求，产出锁定的 Feature 文档。
      GATE-1: 必须先创建 worktree 并切换到 worktree 目录，再进行任何文件操作。
    auto_advance:
      required_context_fields: [worktree_path, branch_name]
      gate_ids: [design-01, design-02]
      accepted_signal_types: [adversarial_consensus]
    roles:
      # ... unchanged

  - key: development
    title: 研发实现
    description: 按设计方案完成实现、自检，并提交一个可检视的 PR。
    auto_advance:
      required_context_fields: [worktree_path, branch_name, pr_url]
      gate_ids: [dev-01, dev-02, dev-03, dev-04, dev-06]
      accepted_signal_types: [gate_complete]
    roles:
      # ... unchanged

  - key: review
    title: PR 检视
    description: 两位审查者对抗性检视 PR，开发者回应和修复，直到没有待处理问题。
    auto_advance:
      required_context_fields: [pr_url]
      gate_ids: [rev-01, rev-02, rev-03, rev-04]
      accepted_signal_types: [adversarial_consensus]
      blocking_rules:
        - type: incompatible_tag
        - type: unresolved_findings
    roles:
      # ... unchanged

  - key: merge
    title: 合入
    description: 维护者执行硬性条件检查，全部通过则使用 Squash Merge 合入 PR。
    # 无 auto_advance — merge 阶段不自动推进
    roles:
      # ... unchanged
```

### 6. 其他 SOP YAML 更新

**code-review/evolution/general-assistant**：这些 SOP 的 stage 不需要自动推进，不声明 `auto_advance`。无需修改 YAML。

### 7. buildContextBlock 更新

**文件**：`src/app/issue-collaboration/collaboration.ts`

```typescript
// Before (L569):
const missingInfra = ["worktree_path", "branch_name"].filter(f => !resolveContextValue(issue.context, f));

// After: 从 sop_snapshot 读取
const stageDef = issue.sop_snapshot.stage_definitions.find(d => d.key === stage.key);
const requiredFields = stageDef?.auto_advance?.required_context_fields ?? [];
const missingInfra = requiredFields.filter(f => !resolveContextValue(issue.context, f));
```

### 8. 测试更新

**文件**：`tests/auto-advance.test.ts`

- 更新 `createStage` helper：通过 `mustGetIssue` 的 `sop_snapshot` 提供 `auto_advance` 配置
- 更新 `createDeps` helper：`mustGetIssue` 返回包含 `sop_snapshot` 的对象
- 验证引擎从配置读取 required_context_fields、gate_ids、accepted_signal_types
- 验证无 `auto_advance` 配置时返回 `NO_AUTO_ADVANCE_CONFIG`
- 验证 blocking_rules 触发时正确阻断
- 验证 R8 通过 blocking_rules 配置驱动
- 验证 R4/R5 通过 artifact 字段存在性推断，不依赖 stage.key

## 生效路径

| 层 | 文件 | 改动类型 |
|---|------|---------|
| domain/model | `src/domain/sop/model.ts` | 新增 `AutoAdvanceConfig`、`BlockingRule` 类型，`StageDefinition` 新增 `auto_advance` |
| domain/repository | `src/domain/sop/_internal/repository.ts` | 解析+序列化 `auto_advance` |
| app/engine | `src/app/issue-collaboration/auto-advance.ts` | 重写：删除全部 `stage.key` 判断和静态 map，改为配置驱动 |
| app/engine | `src/app/issue-collaboration/auto-advance.ts` | `AutoAdvanceDeps.mustGetIssue` 返回类型扩展为包含 `sop_snapshot` |
| app/collaboration | `src/app/issue-collaboration/collaboration.ts` | `buildContextBlock` 缺失警告从 config 读取；`mustGetIssue` 实现适配 |
| data/config | `data/file/sops/code-delivery/code-delivery.yaml` | 声明完整 `auto_advance` 配置 |
| test | `tests/auto-advance.test.ts` | 全面更新 |

## 设计约束摘要

- **配置驱动**：引擎不包含任何 `stage.key` 判断，所有 stage 特有行为从 `auto_advance` 配置读取
- **数据流向**：YAML → StageDefinition → `Issue.sop_snapshot`（冻结副本）→ Engine
- **职责分离**：SOP 声明"如何推进"，引擎执行"按配置校验"，不混入引擎内部
- **disagreement 通用性**：disagreement 是通用信号，在 `accepted_signal_types` 过滤之前处理，所有 stage 都响应（B10）
- **review stage 行为变更**：review stage 从硬编码升级（`MERGE_REQUIRES_HUMAN`）变为正常 auto-advance 评估。这是预期修正——review 有完整的 gate_ids + blocking_rules 配置，应走标准校验链而非硬编码阻断（B11）
- **R4/R5 语义变化**：从"按 stage 要求校验"变为"按 artifact 字段存在性推断"。当前：design 必须有 critique_obligation，review 必须有 file_coverage。新设计：任何有 critique_obligation 的 artifact 必须满足 R4，任何有 file_coverage 的必须满足 R5。这是消除 stage.key 依赖的副作用，在正常流程中不会触发异常（artifact 类型由 stage 的 skill 协议保证）
- **rev-04 正则校验保留**：rev-04 的特性编号格式正则校验（`/^F\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}$/`）保留在引擎中，作为 gate 校验的扩展机制。`gate_ids` 声明 gate ID，引擎对特定 gate 可有额外格式校验
- **allGatesPassed 改造**：`allGatesPassed` 公共方法内部调用 `getAutoAdvanceConfig` 获取 config，或签名扩展为接受 config 参数
- **YAML 配置完整性**：`parseAutoAdvance` 对缺失字段默认为空数组（gate 校验被跳过）。实现阶段建议添加 YAML schema 校验或 linter，确保 `auto_advance` 声明完整
- **不改变 key 命名策略**：保持无前缀策略（F20260629v7k7 D1 决策不变）
- **显式不参与**：无 `auto_advance` 配置的 stage 不参与自动推进，这是设计选择而非兼容 shim

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/domain/sop/model.ts` | 修改 | 新增 `AutoAdvanceConfig`、`BlockingRule`、`BlockingRuleType` 类型；`StageDefinition` 新增 `auto_advance?: AutoAdvanceConfig` |
| `src/domain/sop/_internal/repository.ts` | 修改 | `parseStageDefinition` 读取 `auto_advance`；`serializeSop` 写入 `auto_advance`；新增 `parseAutoAdvance` |
| `src/app/issue-collaboration/auto-advance.ts` | 重写 | 删除 `REQUIRED_CONTEXT_FIELDS`、`getFailedDesignGates`/`getFailedDevGates`/`getFailedReviewGates`、`isIncompatibleBlocked`、`validateStageSpecificFields`；新增 `getAutoAdvanceConfig`、`checkBlockingRules`；重写 `evaluate`、`getMissingContextFields`、`getFailedGates`、`validateAdversarialArtifact`；`AutoAdvanceDeps.mustGetIssue` 返回类型扩展 |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | `buildContextBlock` 缺失警告从 `sop_snapshot` 的 `auto_advance.required_context_fields` 读取；`mustGetIssue` 适配新返回类型 |
| `data/file/sops/code-delivery/code-delivery.yaml` | 修改 | design/development/review stage 添加完整 `auto_advance` 声明 |
| `tests/auto-advance.test.ts` | 重写 | `createDeps` 的 `mustGetIssue` 返回包含 `sop_snapshot`；补充配置驱动测试 |

## 验证

- [x] `AutoAdvanceEngine` 源码中无任何 `stage.key` 判断（grep 验证）— 仅 `inferSignalType`（deprecated）和 `getAutoAdvanceConfig`（config lookup）
- [x] `REQUIRED_CONTEXT_FIELDS` 静态 map 已删除
- [x] `code-delivery.yaml` 各 stage 的 `auto_advance` 配置与原硬编码行为一致
- [x] design stage：缺失 `worktree_path`/`branch_name` → CONTEXT_MISSING；gate 未通过 → GATE_FAILED；共识信号 → 正常推进
- [x] development stage：缺失 context → CONTEXT_MISSING；gate 未通过 → GATE_FAILED；gate_complete → 正常推进
- [x] review stage：缺失 `pr_url` → CONTEXT_MISSING；`[Incompatible]` → INCOMPATIBLE_BLOCKED；unresolved findings → R8 阻断；共识 → 正常推进
- [x] merge stage：无 `auto_advance` → ESCALATED（不自动推进）
- [x] disagreement 信号：任意 stage 收到 disagreement → 始终处理，不受 accepted_signal_types 限制（B10）
- [x] review stage 行为变更：有 auto_advance 配置时走正常 auto-advance 评估，不再硬编码 MERGE_REQUIRES_HUMAN（B11）
- [x] R4/R5 通过 artifact 字段存在性推断，不依赖 stage.key
- [x] `buildContextBlock` 缺失警告从 config 读取，不再硬编码
- [x] `npm run check` 通过
- [x] 相关测试通过（181 tests passed）

## 关联

- **前置**: F20260626m4vx（AutoAdvanceEngine 原始实现）
- **前置**: F20260629v7k7（SOP Context Enforcement，本 feature 替换其硬编码实现）
- **前置**: F20260630uyj5（SOP Auto-advance Full Chain Fix，本 feature 重构其路由逻辑）
- **前置**: F20260630ww93（R8 Finding Resolution Check，本 feature 将 R8 纳入 blocking_rules）
- **前置**: F20260701tj92（Reviewer GATE-4 Engine Enforcement，本 feature 将 rev-04 纳入 gate_ids 配置）
- **相关**: F20260701z3ui（Context 概念优化，本 feature 不改变 key 命名策略）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | 配置粒度：只做 required_context_fields vs 完整 auto_advance | 完整：5 处硬编码是同一根因，一次解决 | 只做 required_context_fields：改动小，风险低 | 完整 auto_advance | 用户要求"不允许单点打补丁"；5 处硬编码互相耦合，只修一处会遗留不一致 | 架构师-1, 用户 | 2026-07-01 |
| D2 | 配置放在哪 | StageDefinition.auto_advance | 独立配置结构 | StageDefinition | auto_advance 是 stage 推进行为的声明，与 stage 语义直接相关 | 架构师-1, 架构师-2 | 2026-07-01 |
| D3 | auto_advance 可选/必填 | 可选：不参与自动推进的 stage 不需要配置 | 必填：强制声明，避免遗漏 | 可选 | 无 auto_advance = 不参与自动推进，是显式设计选择而非兼容 shim；单 stage 终端 SOP 强制声明空配置是噪音 | 架构师-2 | 2026-07-01 |
| D4 | accepted_signal_types 语义 | 排他过滤器：只处理声明的类型 | 多值路由：按类型路由到不同校验链 | 排他过滤器 | 当前引擎 design 阶段实际不接受 gate_complete（L43-46 仅 development）；排他过滤更清晰，消除隐式 fall through | 架构师-2 | 2026-07-01 |
| D5 | R4/R5 如何消除 stage.key | artifact 字段存在性推断 | 配置中声明 artifact 类型 | 字段存在性推断 | `hasDesignFields`/`hasReviewFields` 已是类型守卫，通过字段存在性自动推断比额外配置更简洁 | 架构师-2 | 2026-07-01 |
| D6 | R8 纳入 blocking_rules 还是保留引擎内部 | blocking_rules：与其他阻断规则统一 | 引擎内部：R8 需要 artifact 数据 | blocking_rules | R8 与 incompatible_tag 同类（阻断规则），配置声明意图更清晰；引擎在有 artifact 数据时检查 blocking_rules | 架构师-2 | 2026-07-01 |
| D7 | mustGetIssue 返回类型扩展 vs 新增依赖方法 | 扩展返回类型：最小改动 | 新增方法：接口更干净 | 扩展返回类型 | mustGetIssue 已存在且被广泛使用；sop_snapshot 是 Issue 的固有属性，扩展返回类型语义自然 | 架构师-2 | 2026-07-01 |
| D8 | disagreement 信号处理位置 | accepted_signal_types 过滤之前：disagreement 是通用信号 | 过滤之后：保持配置一致性 | 过滤之前 | disagreement 是人工决策信号，所有 stage 都应响应；disagreement 被过滤是严重行为回归 | 架构师-2 | 2026-07-01 |
| D9 | review stage merge 检测方式 | auto-advance 配置评估：review 有完整配置应走标准校验链 | 保留硬编码：保持现有行为 | 配置评估 | review stage 有 gate_ids + blocking_rules 完整配置，硬编码 `MERGE_REQUIRES_HUMAN` 是过于宽泛的启发式判断；配置评估更精确 | 架构师-2 | 2026-07-01 |

## 范围变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-07-01 | 方案从"只做 required_context_fields"扩展为"完整 auto_advance 配置" | 用户要求不允许单点打补丁；架构师-2 审视发现 8 处硬编码而非 5 处 |
| 2026-07-01 | R8 纳入 blocking_rules 配置 | 架构师-2 审视发现 R8 与 incompatible_tag 同类 |
| 2026-07-01 | auto_advance 改为可选字段 | 架构师-2 审视指出单 stage 终端 SOP 不需要配置 |
| 2026-07-01 | accepted_signal_types 明确为排他过滤器 | 架构师-2 审视发现语义矛盾 |
| 2026-07-01 | disagreement 处理移到 accepted_signal_types 过滤之前 | 架构师-2 对抗分析发现 disagreement 被过滤导致行为回归 |
| 2026-07-01 | review stage 行为变更记录：从硬编码升级变为正常 auto-advance | 架构师-2 对抗分析发现 merge 检测逻辑变更未说明 |
| 2026-07-01 | rev-04 正则校验明确保留在引擎中 | 架构师-2 对抗分析发现 gate 格式校验未配置化 |
| 2026-07-01 | R4/R5 语义变化记录：从 stage-specific 变为 field-presence | 架构师-2 对抗分析发现语义变更 |
