import type { Stage } from "@domain/issue/model";
import type { AutoAdvanceConfig } from "@domain/sop/model";
import type { StageTransitionSuggestion, EvaluationResult, AdversarialArtifact, DesignAdversarialArtifact, ReviewAdversarialArtifact, DecisionMode } from "@app/issue-collaboration/port";
import { resolveContextValue } from "@app/issue-collaboration/resource-cleanup";

/** Gate 元数据：为错误反馈提供可操作的修复指引 */
const GATE_METADATA: Record<string, { description: string; check: string; doc_ref: string }> = {
  "design-01": { description: "Feature 文档的 [design-time] 章节必须已锁定", check: "确认 Feature 文档中所有标记 [design-time] 的章节已填写完成且内容非空", doc_ref: "cd-design/SKILL.md" },
  "design-02": { description: "无未解决的设计争议", check: "确认交叉审视中的所有发现已达成共识或已记录分歧信号", doc_ref: "cd-design/SKILL.md" },
  "design-04": { description: "所有 [required] 章节已填写且内容非空", check: "确认 Feature 文档中所有标记 [required] 的章节已填写", doc_ref: "cd-design/SKILL.md" },
  "design-05": { description: "用户意图锚已填写，逐字引用、修饰语完整", check: "确认用户意图锚表已填写，用户原话为逐字引用，来源有消息 ID", doc_ref: "cd-design/SKILL.md" },
  "dev-01": { description: "代码已在 worktree 中完整实现", check: "确认所有计划的代码修改已在 worktree 中完成", doc_ref: "cd-development/SKILL.md" },
  "dev-02": { description: "自检通过：业务代码按设计意图实现；测试、构建无报错", check: "运行 npm run check 确认测试和构建均通过", doc_ref: "cd-development/SKILL.md" },
  "dev-03": { description: "Feature 文档已同步更新", check: "确认 Feature 文档的 development-time 章节已更新实现记录", doc_ref: "cd-development/SKILL.md" },
  "dev-04": { description: "PR 已创建且包含完整改动摘要", check: "确认 PR 已推送到远端且描述包含改动摘要", doc_ref: "cd-development/SKILL.md" },
  "dev-06": { description: "变更完整性已验证", check: "根据 change_type 执行对应验证命令（如 npm run check），确认输出无报错", doc_ref: "cd-development/SKILL.md" },
  "rev-01": { description: "两位审查者均完成独立检视", check: "确认两位审查者的 adversarial_artifact 均已提交", doc_ref: "cd-review/SKILL.md" },
  "rev-02": { description: "所有发现项已逐条处置", check: "确认 adversarial_findings 中每项 disposition 已填写且不为 'none'", doc_ref: "cd-review/SKILL.md" },
  "rev-03": { description: "复检覆盖完整 PR diff", check: "确认 file_coverage.coverage_ratio = 1.0", doc_ref: "cd-review/SKILL.md" },
  "rev-04": { description: "特性编号格式正确", check: "确认 gate_evidence['rev-04'] 为合法特性编号（F + 8位日期 + 4位随机码）", doc_ref: "cd-shared/references/feature-numbering.md" },
};

/** 校验单条信号，返回 blocked/escalated 或 null（通过）。跳过 SPEAKERS_INSUFFICIENT 和 NO_VALID_SIGNALS（留给 L2）。 */
export function validateSingleSignal(
  stage: Stage,
  suggestion: StageTransitionSuggestion,
  config: AutoAdvanceConfig | undefined,
  issueContext: Record<string, string>,
): EvaluationResult | null {
  const decisionModeError = validateDecisionMode(suggestion);
  if (decisionModeError) return decisionModeError;

  const contextError = validateContextFields(stage, config, issueContext);
  if (contextError) return contextError;

  const gateError = validateGates(config, suggestion);
  if (gateError) return gateError;

  const blockingError = validateBlockingRules(config, issueContext);
  if (blockingError) return blockingError;

  if (suggestion.signal_type === "adversarial_consensus") {
    const artifactError = validateArtifact(stage, config, suggestion);
    if (artifactError) return artifactError;
  }

  return null;
}

function validateDecisionMode(suggestion: StageTransitionSuggestion): EvaluationResult | null {
  const mode = (suggestion.decision_mode ?? "autonomous") as DecisionMode;
  if (mode === "suggestive" && suggestion.signal_type === "disagreement") {
    return { action: "blocked", reasons: [{ code: "INVALID_DECISION_MODE_COMBINATION", severity: "error", message: "decision_mode 'suggestive' 不适用于 disagreement 信号" }] };
  }
  if (mode === "suggestive") {
    if (!suggestion.recommendation) {
      return { action: "blocked", reasons: [{ code: "SUGGESTIVE_MISSING_RECOMMENDATION", severity: "error", message: "suggestive 模式必须包含 recommendation 字段" }] };
    }
    if (!suggestion.reason) {
      return { action: "blocked", reasons: [{ code: "SUGGESTIVE_MISSING_REASON", severity: "error", message: "suggestive 模式必须包含 reason 字段" }] };
    }
    if (!suggestion.alternatives || suggestion.alternatives.length === 0) {
      return { action: "blocked", reasons: [{ code: "SUGGESTIVE_MISSING_ALTERNATIVES", severity: "error", message: "suggestive 模式必须包含 alternatives 字段" }] };
    }
  }
  return null;
}

function validateContextFields(stage: Stage, config: AutoAdvanceConfig | undefined, issueContext: Record<string, string>): EvaluationResult | null {
  if (!config || config.required_context_fields.length === 0) return null;
  const missing = config.required_context_fields.filter(field => !resolveContextValue(issueContext, field));
  if (missing.length === 0) return null;
  const fix_guidance: Record<string, { description: string; check: string; doc_ref: string }> = {};
  for (const field of missing) {
    fix_guidance[field] = {
      description: `Issue 上下文缺少必要字段 "${field}"`,
      check: `通过 set_context 工具设置 "${field}" 的值`,
      doc_ref: "cd-shared/references/stage-gate.md",
    };
  }
  return { action: "blocked", reasons: [{ code: "CONTEXT_MISSING", severity: "error", message: "Issue 上下文缺少必要字段", details: { missing_fields: missing, fix_guidance } }] };
}

function validateGates(config: AutoAdvanceConfig | undefined, suggestion: StageTransitionSuggestion): EvaluationResult | null {
  if (!config) return null;
  const gateEvidence = suggestion.gate_evidence ?? {};
  const failed: string[] = [];
  for (const gate of config.gate_ids) {
    const value = gateEvidence[gate];
    if (typeof value !== "string" || !value.trim()) {
      failed.push(gate);
    }
  }
  if (config.gate_ids.includes("rev-04") && !failed.includes("rev-04")) {
    const rev04 = gateEvidence["rev-04"] as string;
    if (!/^F\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}$/.test(rev04)) {
      failed.push("rev-04");
    }
  }
  if (failed.length === 0) return null;
  /** 为每个失败的 gate 生成修复指引 */
  const fix_guidance: Record<string, { description: string; check: string; doc_ref: string }> = {};
  for (const gate of failed) {
    const meta = GATE_METADATA[gate];
    fix_guidance[gate] = meta ?? { description: `Gate ${gate} 未通过`, check: `确认 gate_evidence["${gate}"] 为非空字符串`, doc_ref: "cd-shared/references/adversarial-artifact-protocol.md" };
  }
  return { action: "blocked", reasons: [{ code: "GATE_FAILED", severity: "error", message: `Gate 自检未通过：${failed.join(", ")}`, details: { failed_gates: failed, fix_guidance } }] };
}

function validateBlockingRules(config: AutoAdvanceConfig | undefined, issueContext: Record<string, string>): EvaluationResult | null {
  if (!config?.blocking_rules) return null;
  for (const rule of config.blocking_rules) {
    if (rule.type === "incompatible_tag") {
      const prTitle = resolveContextValue(issueContext, "pr_title") ?? "";
      if (prTitle.includes("[Incompatible]")) {
        return { action: "blocked", reasons: [{ code: "INCOMPATIBLE_BLOCKED", severity: "warning", message: "PR 标题含 [Incompatible]，阻断自动推进" }] };
      }
    }
  }
  return null;
}

export function validateArtifact(stage: Stage, config: AutoAdvanceConfig | undefined, suggestion: StageTransitionSuggestion): EvaluationResult | null {
  const result = validateAdversarialArtifactWithConfig(stage, config, suggestion);
  if (!result.valid) {
    const errorCode = result.rule === "R1_ARTIFACT_MISSING" ? "ADVERSARIAL_ARTIFACT_MISSING" : "ADVERSARIAL_VALIDATION_FAILED";
    return { action: "blocked", reasons: [{ code: errorCode, severity: "error", message: `对抗产物校验失败：${result.reason}`, details: { rule: result.rule } }] };
  }
  return null;
}

function validateAdversarialArtifactWithConfig(stage: Stage, config: AutoAdvanceConfig | undefined, suggestion: StageTransitionSuggestion): { valid: boolean; reason?: string; rule?: string; allClear?: boolean } {
  const artifact = suggestion.adversarial_artifact;
  if (!artifact) return { valid: false, reason: "missing adversarial_artifact", rule: "R1_ARTIFACT_MISSING" };

  const auditResult = validateAuditTrail(artifact);
  if (auditResult) return { ...auditResult, rule: "R2" };

  if (artifact.independent_verification.some(v => v.actual_output.length < 20)) {
    return { valid: false, reason: "independent_verification actual_output too short (< 20 chars)", rule: "R3" };
  }

  const stageResult = validateStageSpecificFields(artifact);
  if (stageResult) return stageResult;

  if (artifact.adversarial_findings.length === 0) {
    return { valid: false, reason: "adversarial_findings must not be empty", rule: "R1" };
  }

  if (config?.blocking_rules?.some(r => r.type === "unresolved_findings")) {
    const unresolvedFindings = artifact.adversarial_findings.filter(
      f => f.finding !== "no issues" && (f.disposition === "none" || (f.disposition ?? "").trim() === ""),
    );
    if (unresolvedFindings.length > 0) {
      return { valid: false, reason: `${unresolvedFindings.length} finding(s) with unresolved disposition`, rule: "R8" };
    }
  }

  const allClear = artifact.adversarial_findings.every(f => f.finding === "no issues");
  return { valid: true, allClear };
}

function validateAuditTrail(artifact: AdversarialArtifact): { valid: false; reason: string } | null {
  const reviewStarted = artifact.audit_trail.events.find(e => e.event_type === 'review_started');
  const crossReviewRead = artifact.audit_trail.events.find(e => e.event_type === 'cross_review_read');
  if (!crossReviewRead) return { valid: false, reason: "audit_trail missing cross_review_read event" };
  if (reviewStarted && crossReviewRead.timestamp <= reviewStarted.timestamp) {
    return { valid: false, reason: "audit_trail cross_review_read timestamp must be after review_started" };
  }
  return null;
}

function validateStageSpecificFields(artifact: AdversarialArtifact | DesignAdversarialArtifact | ReviewAdversarialArtifact): { valid: boolean; reason?: string; rule?: string } | null {
  if ("critique_obligation" in artifact || "independent_analysis" in artifact || "scenario_coverage" in artifact) {
    return validateDesignFields(artifact);
  }
  if ("file_coverage" in artifact || "file_dispositions" in artifact || "cross_review" in artifact || "ci_independence" in artifact) {
    return validateReviewFields(artifact);
  }
  return null;
}

function validateDesignFields(artifact: AdversarialArtifact | DesignAdversarialArtifact): { valid: boolean; reason?: string; rule?: string } | null {
  if (!("critique_obligation" in artifact) || !artifact.critique_obligation || !Array.isArray(artifact.critique_obligation.items) || artifact.critique_obligation.items.length < 4) {
    return { valid: false, reason: "design stage requires critique_obligation.items >= 4", rule: "R4" };
  }
  if (!("scenario_coverage" in artifact) || !artifact.scenario_coverage || !Array.isArray(artifact.scenario_coverage.constructed_scenarios) || artifact.scenario_coverage.constructed_scenarios.length < 2) {
    return { valid: false, reason: "design stage requires scenario_coverage.constructed_scenarios >= 2", rule: "R4b" };
  }
  return null;
}

function validateReviewFields(artifact: AdversarialArtifact | ReviewAdversarialArtifact): { valid: boolean; reason?: string; rule?: string } | null {
  if (!("file_coverage" in artifact) || !artifact.file_coverage || typeof artifact.file_coverage.coverage_ratio !== "number" || artifact.file_coverage.coverage_ratio !== 1.0) {
    return { valid: false, reason: "review stage requires file_coverage.coverage_ratio = 1.0", rule: "R5" };
  }
  return null;
}
