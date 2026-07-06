import type { Stage } from "@domain/issue/model";
import type { AutoAdvanceConfig } from "@domain/sop/model";
import type { StageTransitionSuggestion, EvaluationResult } from "@app/issue-collaboration/port";
import { resolveContextValue } from "@app/issue-collaboration/resource-cleanup";
import { GATE_METADATA } from "@domain/collaboration/gate-metadata";

/**
 * 系统自动检查的 gate：不依赖 agent 输入，系统直接检查 issue context 或 stage 状态。
 * 返回未通过的 gate ID 列表（空数组表示全部通过）。
 */
function checkSystemGates(config: AutoAdvanceConfig | undefined, issueContext: Record<string, string>): string[] {
  if (!config) return [];
  const failed: string[] = [];
  for (const gate of config.gate_ids) {
    const ok = checkSystemGate(gate, issueContext);
    if (!ok) failed.push(gate);
  }
  return failed;
}

/** 单个 gate 的系统自动检查。prompt 级 gate 始终返回 true（agent 在 reason 中自证）。 */
function checkSystemGate(gate: string, ctx: Record<string, string>): boolean {
  switch (gate) {
    case "design-01":
      /** 检查 issue context 中是否有 feature_doc_path 指向的文件 */
      return !!resolveContextValue(ctx, "feature_doc_path");
    case "design-02":
      /** 检查当前 stage 是否存在未解决的 disagreement 信号 — 降级为 prompt 级（系统无法在 L1 层检查） */
      return true;
    case "dev-04":
      /** 检查 issue context 中的 pr_url 字段 */
      return !!resolveContextValue(ctx, "pr_url");
    case "rev-04": {
      /** 从 issue context 的 feature_number 字段获取特性编号，正则校验 */
      const featureNumber = resolveContextValue(ctx, "feature_number");
      if (!featureNumber) return false;
      return /^F\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}$/.test(featureNumber);
    }
    default:
      /** prompt 级 gate：dev-01, dev-02, dev-03, dev-06, rev-01, rev-02, rev-03 — agent 在 reason 中自证 */
      return true;
  }
}

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
