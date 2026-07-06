import type { Stage } from "@domain/issue/model";
import type { Sop, AutoAdvanceConfig } from "@domain/sop/model";
import type { StageTransitionSuggestion, EvaluationResult } from "@app/issue-collaboration/port";
import { resolveContextValue } from "@app/issue-collaboration/resource-cleanup";
import { buildGateFixGuidance } from "@domain/collaboration/gate-metadata";
import { checkSystemGate, inferSignalType } from "@app/issue-collaboration/gate-check";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "auto-advance" });

export interface AutoAdvanceDeps {
  advanceStage(stageId: string, targetKey: string): Promise<Stage>;
  recordAuditTrail(fromStage: Stage, toStage: Stage, suggestion: StageTransitionSuggestion): Promise<void>;
  notifyConsumers(stageId: string, method: string, ...args: unknown[]): Promise<void>;
  generateDisagreementCard(stageId: string, suggestion: StageTransitionSuggestion): Promise<void>;
  mustGetIssue(issueId: string): { context: Record<string, string>; sop_snapshot: Sop };
}

export class AutoAdvanceEngine {
  constructor(private readonly deps: AutoAdvanceDeps) {}

  async evaluate(stage: Stage, suggestions: StageTransitionSuggestion[]): Promise<EvaluationResult> {
    const result = await this.evaluateAdvance(stage, suggestions);
    if (result.action === "auto_advanced" && result.target_key) {
      const suggestion = suggestions.find(s => s.target_key === result.target_key);
      if (suggestion) await this.executeAutoAdvance(stage, suggestion);
    }
    return result;
  }

  /**
   * L2: 仅评估，不执行自动推进。用于手动推进前的门控检查。
   */
  async evaluateAdvance(stage: Stage, suggestions: StageTransitionSuggestion[]): Promise<EvaluationResult> {
    if (suggestions.length === 0) {
      return { action: "blocked", reasons: [{ code: "NO_SIGNALS", severity: "info", message: "无信号" }] };
    }

    const config = this.getAutoAdvanceConfig(stage);

    const typedSuggestions = suggestions.map(s => ({
      ...s,
      signal_type: s.signal_type ?? inferSignalType(config),
    }));

    // 分歧信号优先处理（通用逻辑，所有 stage 都处理，不受 accepted_signal_types 限制）
    const disagreements = typedSuggestions.filter(s => s.signal_type === "disagreement");
    if (disagreements.length > 0) {
      return await this.handleDisagreement(stage.id, disagreements[disagreements.length - 1]);
    }

    // 无 auto_advance 配置 → 不参与自动推进，升级到人工
    if (!config) {
      return { action: "escalated", reasons: [{ code: "NO_AUTO_ADVANCE_CONFIG", severity: "info", message: "该阶段未配置自动推进" }] };
    }

    // 按 accepted_signal_types 过滤
    const acceptedSuggestions = typedSuggestions.filter(s =>
      config.accepted_signal_types.includes(s.signal_type!)
    );
    if (acceptedSuggestions.length === 0) {
      return { action: "blocked", reasons: [{ code: "NO_VALID_SIGNALS", severity: "info", message: "无有效信号" }] };
    }

    // 按 signal_type 路由到对应校验链
    const latest = acceptedSuggestions[acceptedSuggestions.length - 1];
    if (latest.signal_type === "gate_complete") {
      return await this.evaluateGateComplete(stage, config, acceptedSuggestions);
    }
    if (latest.signal_type === "adversarial_consensus") {
      return await this.evaluateAdversarialConsensus(stage, config, acceptedSuggestions);
    }

    return { action: "blocked", reasons: [{ code: "NO_VALID_SIGNALS", severity: "info", message: "无有效信号" }] };
  }

  private async handleDisagreement(stageId: string, disagreement: StageTransitionSuggestion): Promise<EvaluationResult> {
    const reviewRound = (disagreement.review_round ?? 0) + 1;
    disagreement.review_round = reviewRound;
    await this.deps.generateDisagreementCard(stageId, disagreement);
    if (reviewRound > 1) {
      log.warn({ stageId, reviewRound }, "review round exceeds threshold");
    }
    return {
      action: "escalated",
      reasons: [{ code: "DISAGREEMENT", severity: "warning", message: "存在分歧，需人工决策", details: { review_round: reviewRound } }],
    };
  }

  private async evaluateGateComplete(stage: Stage, config: AutoAdvanceConfig, suggestions: StageTransitionSuggestion[]): Promise<EvaluationResult> {
    const missingContext = this.getMissingContextFields(stage, config);
    if (missingContext.length > 0) {
      await this.notifyMissingContext(stage.id, missingContext);
      return { action: "blocked", reasons: [{ code: "CONTEXT_MISSING", severity: "error", message: "Issue 上下文缺少必要字段", details: { missing_fields: missingContext, fix_guidance: Object.fromEntries(missingContext.map(f => [f, { description: `Issue 上下文缺少必要字段 "${f}"`, check: `通过 set_context 工具设置 "${f}" 的值`, doc_ref: "cd-shared/references/stage-gate.md" }])) } }] };
    }
    const latest = suggestions[suggestions.length - 1];
    const failedGates = this.getFailedGates(stage, config);
    if (failedGates.length > 0) {
      return { action: "blocked", reasons: [{ code: "GATE_FAILED", severity: "error", message: `Gate 自检未通过：${failedGates.join(", ")}`, details: { failed_gates: failedGates, fix_guidance: buildGateFixGuidance(failedGates) } }] };
    }
    return { action: "auto_advanced", target_key: latest.target_key, reasons: [{ code: "AUTO_ADVANCED", severity: "info", message: "自动推进成功" }] };
  }

  private async evaluateAdversarialConsensus(stage: Stage, config: AutoAdvanceConfig, consensusSignals: StageTransitionSuggestion[]): Promise<EvaluationResult> {
    /** Speaker count ≥ 2 — 结构性保证两个 agent 都同意 */
    const uniqueSpeakers = new Set(consensusSignals.map(s => s.from_speaker));
    if (uniqueSpeakers.size < 2) {
      return { action: "blocked", reasons: [{ code: "SPEAKERS_INSUFFICIENT", severity: "warning", message: `需要 2 个不同 speaker 的共识信号，当前 ${uniqueSpeakers.size} 个`, details: { current_speakers: [...uniqueSpeakers] } }] };
    }

    const missingContext = this.getMissingContextFields(stage, config);
    if (missingContext.length > 0) {
      await this.notifyMissingContext(stage.id, missingContext);
      return { action: "blocked", reasons: [{ code: "CONTEXT_MISSING", severity: "error", message: "Issue 上下文缺少必要字段", details: { missing_fields: missingContext, fix_guidance: Object.fromEntries(missingContext.map(f => [f, { description: `Issue 上下文缺少必要字段 "${f}"`, check: `通过 set_context 工具设置 "${f}" 的值`, doc_ref: "cd-shared/references/stage-gate.md" }])) } }] };
    }

    const blockingResult = this.checkBlockingRules(stage, config);
    if (blockingResult) {
      return { action: "blocked", reasons: [{ code: blockingResult, severity: "warning", message: blockingResult === "INCOMPATIBLE_BLOCKED" ? "PR 标题含 [Incompatible]，阻断自动推进" : "阻断规则触发" }] };
    }

    const failedGates = this.getFailedGates(stage, config);
    if (failedGates.length > 0) {
      return { action: "blocked", reasons: [{ code: "GATE_FAILED", severity: "error", message: `Gate 自检未通过：${failedGates.join(", ")}`, details: { failed_gates: failedGates, fix_guidance: buildGateFixGuidance(failedGates) } }] };
    }

    const latest = consensusSignals[consensusSignals.length - 1];
    return { action: "auto_advanced", target_key: latest.target_key, reasons: [{ code: "AUTO_ADVANCED", severity: "info", message: "自动推进成功" }] };
  }

  /** 从 Issue.sop_snapshot 读取当前 stage 的 auto_advance 配置 */
  getAutoAdvanceConfig(stage: Stage): AutoAdvanceConfig | undefined {
    const issue = this.deps.mustGetIssue(stage.issue_id);
    const stageDef = issue.sop_snapshot.stage_definitions.find(d => d.key === stage.key);
    return stageDef?.auto_advance;
  }

  private getMissingContextFields(stage: Stage, config: AutoAdvanceConfig): string[] {
    if (config.required_context_fields.length === 0) return [];
    const issue = this.deps.mustGetIssue(stage.issue_id);
    return config.required_context_fields.filter(field => !resolveContextValue(issue.context, field));
  }

  private async notifyMissingContext(stageId: string, missingFields: string[]): Promise<void> {
    log.warn({ stageId, missingFields }, "auto-advance blocked: missing context fields");
    await this.deps.notifyConsumers(stageId, "onContextMissing", { missing_fields: missingFields });
  }

  /** 配置驱动的阻断规则检查 */
  private checkBlockingRules(stage: Stage, config: AutoAdvanceConfig): string | null {
    if (!config.blocking_rules) return null;
    const issue = this.deps.mustGetIssue(stage.issue_id);
    for (const rule of config.blocking_rules) {
      if (rule.type === "incompatible_tag") {
        const prTitle = resolveContextValue(issue.context, "pr_title") ?? "";
        if (prTitle.includes("[Incompatible]")) {
          log.info({ stageId: stage.id }, "[Incompatible] tag blocks auto-advance");
          return "INCOMPATIBLE_BLOCKED";
        }
      }
    }
    return null;
  }

  private async executeAutoAdvance(stage: Stage, suggestion: StageTransitionSuggestion): Promise<void> {
    const targetKey = suggestion.target_key;
    const newStage = await this.deps.advanceStage(stage.id, targetKey);
    await this.deps.recordAuditTrail(stage, newStage, suggestion);
    await this.deps.notifyConsumers(newStage.id, "onAutoAdvanced", {
      from: stage.id, to: newStage.id, from_key: stage.key, to_key: newStage.key, reason: suggestion.reason
    });
  }

  /**
   * 系统自动检查 gate：检查 issue context 字段和正则校验。
   * prompt 级 gate（dev-01, dev-02, dev-03, dev-06, rev-01, rev-02, rev-03）始终通过。
   */
  private getFailedGates(stage: Stage, config: AutoAdvanceConfig): string[] {
    const issue = this.deps.mustGetIssue(stage.issue_id);
    const ctx = issue.context;
    const failed: string[] = [];
    for (const gate of config.gate_ids) {
      if (!checkSystemGate(gate, ctx)) failed.push(gate);
    }
    return failed;
  }

  /** 保留 allGatesPassed 供外部调用（如测试） */
  allGatesPassed(stage: Stage): boolean {
    const config = this.getAutoAdvanceConfig(stage);
    if (!config) return false;
    return this.getFailedGates(stage, config).length === 0;
  }
}
