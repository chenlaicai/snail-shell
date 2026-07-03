import type { MCPServerConfig } from "@domain/snail-mcp-server/model";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { Stage } from "@domain/issue/model";
import type { AutoAdvanceConfig } from "@domain/sop/model";
import { getLogger } from "@infra/logger";
import { GATE_METADATA } from "@domain/collaboration/gate-metadata";

const log = getLogger({ module: "snail-signal-validation" });

interface ValidationReason {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
}

interface SignalSuggestion {
  signal_type: string;
  decision_mode: string;
  target_key: string;
  reason: string;
  gate_evidence?: Record<string, unknown>;
  adversarial_artifact?: {
    independent_verification: { command: string; actual_output: string; executed_at: string }[];
    adversarial_findings: { dimension: string; finding: string; disposition: string }[];
    audit_trail: { events: { timestamp: string; event_type: string; detail: string }[] };
    critique_obligation?: { items: { type: string; content: string }[] };
    scenario_coverage?: { constructed_scenarios: { scenario: string; question: string }[] };
    independent_analysis?: { my_conclusion: string; comparison_with_peer: string; points_of_agreement: string[]; points_of_disagreement: string[] };
    file_coverage?: { coverage_ratio: number };
  };
  recommendation?: string;
  alternatives?: string[];
}

/** AI 信号预校验 MCP Server。让 AI 在发出 stage_transition 信号前先调用校验。 */
export function createSignalValidationServer(stagePort: StagePort, issuePort: IssuePort): MCPServerConfig {
  return {
    name: "snail-signal-validation",
    version: "1.0.0",
    tools: [
      {
        name: "validate_stage_signal",
        description:
          "校验 stage_transition 信号是否能通过推进引擎。" +
          "在调用 set_final_body 发出信号前应先调用此工具。" +
          "如果返回 valid: false，根据 reasons 自纠后再次调用。最多重试 2 次。",
        inputSchema: {
          type: "object",
          properties: {
            stage_id: { type: "string", description: "当前 stage 的 ID，通过环境变量 SNAIL_CTX_STAGE_ID 注入" },
            target_key: { type: "string", description: "目标阶段 key" },
            signal_type: { type: "string", enum: ["gate_complete", "adversarial_consensus", "disagreement"], description: "信号类型" },
            gate_evidence: { type: "object", description: "Gate 自检证据（gate_complete 和 adversarial_consensus 必填）" },
            adversarial_artifact: { type: "object", description: "对抗产物（adversarial_consensus 必填）" },
            reason: { type: "string", description: "推进理由" },
            guard: { type: "string", description: "守门条件" },
            decision_mode: { type: "string", enum: ["autonomous", "suggestive", "requires_human"], description: "决策模式，默认 autonomous" },
            recommendation: { type: "string", description: "suggestive 模式必填" },
            alternatives: { type: "array", items: { type: "string" }, description: "suggestive 模式必填" },
          },
          required: ["stage_id", "target_key", "signal_type", "reason"],
        },
        handler: async (params) => {
          const stageId = params.stage_id as string;
          if (!stageId) throw new Error("stage_id is required");

          const stage = stagePort.findStage(stageId);
          if (!stage) throw new Error(`stage not found: ${stageId}`);

          const issue = issuePort.findIssue(stage.issue_id);
          if (!issue) throw new Error(`issue not found: ${stage.issue_id}`);

          const config = issue.sop_snapshot.stage_definitions.find(d => d.key === stage.key)?.auto_advance;

          const suggestion: SignalSuggestion = {
            signal_type: (params.signal_type as string) ?? "gate_complete",
            decision_mode: (params.decision_mode as string) ?? "autonomous",
            target_key: params.target_key as string,
            reason: params.reason as string,
            gate_evidence: params.gate_evidence as Record<string, unknown> | undefined,
            adversarial_artifact: params.adversarial_artifact as SignalSuggestion["adversarial_artifact"],
            recommendation: params.recommendation as string | undefined,
            alternatives: params.alternatives as string[] | undefined,
          };

          const result = validateSignal(stage, suggestion, config, issue.context);
          log.info({ stageId, signalType: suggestion.signal_type, valid: !result }, "validate_stage_signal");

          if (!result) return { valid: true };
          return { valid: false, reasons: result };
        },
      },
    ],
  };
}

/** 单条信号校验，返回阻断原因数组或 null（通过）。跳过 SPEAKERS_INSUFFICIENT 和 NO_VALID_SIGNALS。 */
function validateSignal(
  stage: Stage,
  suggestion: SignalSuggestion,
  config: AutoAdvanceConfig | undefined,
  issueContext: Record<string, string>,
): ValidationReason[] | null {
  const reasons: ValidationReason[] = [];

  const decisionErr = checkDecisionMode(suggestion);
  if (decisionErr) reasons.push(decisionErr);

  const contextErr = checkContextFields(config, issueContext);
  if (contextErr) reasons.push(contextErr);

  const gateErr = checkGates(config, suggestion);
  if (gateErr) reasons.push(gateErr);

  const blockingErr = checkBlockingRules(config, issueContext);
  if (blockingErr) reasons.push(blockingErr);

  if (suggestion.signal_type === "adversarial_consensus") {
    const artifactErrs = checkArtifact(stage, config, suggestion);
    reasons.push(...artifactErrs);
  }

  return reasons.length > 0 ? reasons : null;
}

function checkDecisionMode(s: SignalSuggestion): ValidationReason | null {
  if (s.decision_mode === "suggestive" && s.signal_type === "disagreement") {
    return { code: "INVALID_DECISION_MODE_COMBINATION", severity: "error", message: "decision_mode 'suggestive' 不适用于 disagreement 信号" };
  }
  if (s.decision_mode === "suggestive") {
    if (!s.recommendation) return { code: "SUGGESTIVE_MISSING_RECOMMENDATION", severity: "error", message: "suggestive 模式必须包含 recommendation 字段" };
    if (!s.reason) return { code: "SUGGESTIVE_MISSING_REASON", severity: "error", message: "suggestive 模式必须包含 reason 字段" };
    if (!s.alternatives?.length) return { code: "SUGGESTIVE_MISSING_ALTERNATIVES", severity: "error", message: "suggestive 模式必须包含 alternatives 字段" };
  }
  return null;
}

function checkContextFields(config: AutoAdvanceConfig | undefined, ctx: Record<string, string>): ValidationReason | null {
  if (!config?.required_context_fields?.length) return null;
  const missing = config.required_context_fields.filter(f => !resolveContext(ctx, f));
  if (missing.length === 0) return null;
  const fix_guidance: Record<string, { description: string; check: string; doc_ref: string }> = {};
  for (const field of missing) {
    fix_guidance[field] = {
      description: `Issue 上下文缺少必要字段 "${field}"`,
      check: `通过 set_context 工具设置 "${field}" 的值`,
      doc_ref: "cd-shared/references/stage-gate.md",
    };
  }
  return { code: "CONTEXT_MISSING", severity: "error", message: "Issue 上下文缺少必要字段", details: { missing_fields: missing, fix_guidance } };
}

function checkGates(config: AutoAdvanceConfig | undefined, s: SignalSuggestion): ValidationReason | null {
  if (!config) return null;
  const evidence = s.gate_evidence ?? {};
  const failed = config.gate_ids.filter(g => { const v = evidence[g]; return typeof v !== "string" || !v.trim(); });
  if (config.gate_ids.includes("rev-04") && !failed.includes("rev-04")) {
    const rev04 = evidence["rev-04"] as string;
    if (!/^F\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}$/.test(rev04)) failed.push("rev-04");
  }
  if (failed.length === 0) return null;
  /** 为每个失败的 gate 生成修复指引 */
  const fix_guidance: Record<string, { description: string; check: string; doc_ref: string }> = {};
  for (const gate of failed) {
    const meta = GATE_METADATA[gate];
    fix_guidance[gate] = meta ?? { description: `Gate ${gate} 未通过`, check: `确认 gate_evidence["${gate}"] 为非空字符串`, doc_ref: "cd-shared/references/adversarial-artifact-protocol.md" };
  }
  return { code: "GATE_FAILED", severity: "error", message: `Gate 自检未通过：${failed.join(", ")}`, details: { failed_gates: failed, fix_guidance } };
}

function checkBlockingRules(config: AutoAdvanceConfig | undefined, ctx: Record<string, string>): ValidationReason | null {
  if (!config?.blocking_rules) return null;
  for (const rule of config.blocking_rules) {
    if (rule.type === "incompatible_tag" && (resolveContext(ctx, "pr_title") ?? "").includes("[Incompatible]")) {
      return { code: "INCOMPATIBLE_BLOCKED", severity: "warning", message: "PR 标题含 [Incompatible]，阻断自动推进" };
    }
  }
  return null;
}

function checkArtifact(stage: Stage, config: AutoAdvanceConfig | undefined, s: SignalSuggestion): ValidationReason[] {
  const reasons: ValidationReason[] = [];
  const artifact = s.adversarial_artifact;
  if (!artifact) return [{ code: "ADVERSARIAL_ARTIFACT_MISSING", severity: "error", message: "对抗产物校验失败：missing adversarial_artifact" }];

  const auditErr = checkAuditTrail(artifact);
  if (auditErr) { reasons.push({ code: "ADVERSARIAL_VALIDATION_FAILED", severity: "error", message: `对抗产物校验失败：${auditErr}` }); return reasons; }

  if (artifact.independent_verification.some(v => v.actual_output.length < 20)) {
    reasons.push({ code: "ADVERSARIAL_VALIDATION_FAILED", severity: "error", message: "对抗产物校验失败：independent_verification actual_output too short (< 20 chars)" });
    return reasons;
  }

  const stageErr = checkStageFields(artifact);
  if (stageErr) { reasons.push({ code: "ADVERSARIAL_VALIDATION_FAILED", severity: "error", message: `对抗产物校验失败：${stageErr}` }); return reasons; }

  if (artifact.adversarial_findings.length === 0) {
    reasons.push({ code: "ADVERSARIAL_VALIDATION_FAILED", severity: "error", message: "对抗产物校验失败：adversarial_findings must not be empty" });
    return reasons;
  }

  if (config?.blocking_rules?.some(r => r.type === "unresolved_findings")) {
    const unresolved = artifact.adversarial_findings.filter(f => f.finding !== "no issues" && (!f.disposition || f.disposition === "none" || !f.disposition.trim()));
    if (unresolved.length > 0) {
      reasons.push({ code: "ADVERSARIAL_VALIDATION_FAILED", severity: "error", message: `对抗产物校验失败：${unresolved.length} finding(s) with unresolved disposition` });
    }
  }

  return reasons;
}

function checkAuditTrail(artifact: NonNullable<SignalSuggestion["adversarial_artifact"]>): string | null {
  const started = artifact.audit_trail.events.find(e => e.event_type === "review_started");
  const crossRead = artifact.audit_trail.events.find(e => e.event_type === "cross_review_read");
  if (!crossRead) return "audit_trail missing cross_review_read event";
  if (started && crossRead.timestamp <= started.timestamp) return "audit_trail cross_review_read timestamp must be after review_started";
  return null;
}

function checkStageFields(artifact: NonNullable<SignalSuggestion["adversarial_artifact"]>): string | null {
  if (artifact.critique_obligation || artifact.scenario_coverage || artifact.independent_analysis) {
    if (!artifact.critique_obligation?.items || artifact.critique_obligation.items.length < 4) return "design stage requires critique_obligation.items >= 4";
    if (!artifact.scenario_coverage?.constructed_scenarios || artifact.scenario_coverage.constructed_scenarios.length < 2) return "design stage requires scenario_coverage.constructed_scenarios >= 2";
  }
  if (artifact.file_coverage !== undefined) {
    if (typeof artifact.file_coverage.coverage_ratio !== "number" || artifact.file_coverage.coverage_ratio !== 1.0) return "review stage requires file_coverage.coverage_ratio = 1.0";
  }
  return null;
}

function resolveContext(context: Record<string, string>, key: string): string | undefined {
  const exact = context[key]?.trim();
  if (exact) return exact;
  const suffix = `.${key}`;
  for (const k of Object.keys(context)) {
    if (k.endsWith(suffix)) {
      const val = context[k]?.trim();
      if (val) return val;
    }
  }
  return undefined;
}
