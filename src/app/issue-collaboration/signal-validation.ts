import type { Stage } from "@domain/issue/model";
import type { AutoAdvanceConfig } from "@domain/sop/model";
import type { StageTransitionSuggestion, EvaluationResult } from "@app/issue-collaboration/port";
import { resolveContextValue } from "@app/issue-collaboration/resource-cleanup";
import { checkSystemGates } from "@app/issue-collaboration/gate-check";
import { GATE_METADATA } from "@domain/collaboration/gate-metadata";

/** 校验单条信号，返回 blocked 或 null（通过）。 */
export function validateSingleSignal(
  stage: Stage,
  suggestion: StageTransitionSuggestion,
  config: AutoAdvanceConfig | undefined,
  issueContext: Record<string, string>,
): EvaluationResult | null {
  const contextError = validateContextFields(config, issueContext);
  if (contextError) return contextError;

  const gateError = validateSystemGates(config, issueContext);
  if (gateError) return gateError;

  const blockingError = validateBlockingRules(config, issueContext);
  if (blockingError) return blockingError;

  return null;
}

function validateContextFields(config: AutoAdvanceConfig | undefined, issueContext: Record<string, string>): EvaluationResult | null {
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

function validateSystemGates(config: AutoAdvanceConfig | undefined, issueContext: Record<string, string>): EvaluationResult | null {
  if (!config) return null;
  const failed = checkSystemGates(config, issueContext);
  if (failed.length === 0) return null;
  /** 为每个失败的 gate 生成修复指引 */
  const fix_guidance: Record<string, { description: string; check: string; doc_ref: string }> = {};
  for (const gate of failed) {
    const meta = GATE_METADATA[gate];
    fix_guidance[gate] = meta ?? { description: `Gate ${gate} 未通过`, check: `确认系统检查条件满足`, doc_ref: "cd-shared/references/stage-gate.md" };
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
