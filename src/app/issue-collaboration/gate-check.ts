import type { AutoAdvanceConfig } from "@domain/sop/model";
import type { SignalType } from "@app/issue-collaboration/port";
import { resolveContextValue } from "@app/issue-collaboration/resource-cleanup";

/**
 * 系统自动检查的 gate：不依赖 agent 输入，系统直接检查 issue context 或 stage 状态。
 * 返回未通过的 gate ID 列表（空数组表示全部通过）。
 */
export function checkSystemGates(config: AutoAdvanceConfig | undefined, issueContext: Record<string, string>): string[] {
  if (!config) return [];
  const failed: string[] = [];
  for (const gate of config.gate_ids) {
    if (!checkSystemGate(gate, issueContext)) failed.push(gate);
  }
  return failed;
}

/** 单个 gate 的系统自动检查。prompt 级 gate 始终返回 true（agent 在 reason 中自证）。 */
export function checkSystemGate(gate: string, ctx: Record<string, string>): boolean {
  switch (gate) {
    case "design-01":
      /** 检查 issue context 中是否有 feature_doc_path 指向的文件 */
      return !!resolveContextValue(ctx, "feature_doc_path");
    case "design-02":
      /** 降级为 prompt 级（系统无法在 L1/L2 层检查 disagreement 状态） */
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
    case "rev-03": {
      /** 检查 issue context 中是否有 review_comment_url（每轮检视必须写入新评论 URL） */
      return !!resolveContextValue(ctx, "review_comment_url");
    }
    default:
      /** prompt 级 gate：dev-01, dev-02, dev-03, dev-06, rev-01, rev-02 — agent 在 reason 中自证 */
      return true;
  }
}

/** 从 stage config 的 accepted_signal_types 推断信号类型 */
export function inferSignalType(config: { accepted_signal_types: string[] } | undefined): SignalType {
  if (!config) return "gate_complete";
  if (config.accepted_signal_types.includes("adversarial_consensus")) return "adversarial_consensus";
  return "gate_complete";
}

/** 检查 required_context_fields，返回缺失字段列表（空数组表示全部通过）。L1/L2 共享。 */
export function getMissingContextFields(config: AutoAdvanceConfig | undefined, context: Record<string, string>): string[] {
  if (!config || config.required_context_fields.length === 0) return [];
  return config.required_context_fields.filter(field => !resolveContextValue(context, field));
}

/** 检查 blocking_rules，返回触发的阻断规则 code（null 表示通过）。L1/L2 共享。 */
export function checkBlockingRules(config: AutoAdvanceConfig | undefined, context: Record<string, string>): string | null {
  if (!config?.blocking_rules) return null;
  for (const rule of config.blocking_rules) {
    if (rule.type === "incompatible_tag") {
      const prTitle = resolveContextValue(context, "pr_title") ?? "";
      if (prTitle.includes("[Incompatible]")) {
        return "INCOMPATIBLE_BLOCKED";
      }
    }
  }
  return null;
}
