import type { Stage } from "@domain/issue/model";
import type { Sop, AutoAdvanceConfig } from "@domain/sop/model";
import type { StageTransitionSuggestion, AdversarialArtifact, DesignAdversarialArtifact, ReviewAdversarialArtifact, SignalType, DecisionMode, EvaluationResult, EvaluationReason } from "@app/issue-collaboration/port";
import { resolveContextValue } from "@app/issue-collaboration/resource-cleanup";
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
    if (suggestions.length === 0) {
      return { action: "blocked", reasons: [{ code: "NO_SIGNALS", severity: "info", message: "无信号" }] };
    }

    // 按 signal_type 路由（向后兼容：推断 signal_type）
    const typedSuggestions = suggestions.map(s => ({
      ...s,
      signal_type: s.signal_type ?? this.inferSignalType(s, stage.key),
      /** 向后兼容：缺失 decision_mode 时默认 autonomous */
      decision_mode: s.decision_mode ?? "autonomous",
    }));

    // Decision Mode 校验（B3）
    const decisionModeError = this.validateDecisionModes(typedSuggestions);
    if (decisionModeError) return decisionModeError;

    // 分歧信号优先处理（通用逻辑，所有 stage 都处理，不受 accepted_signal_types 限制）
    const disagreements = typedSuggestions.filter(s => s.signal_type === "disagreement");
    if (disagreements.length > 0) {
      return await this.handleDisagreement(stage.id, disagreements[disagreements.length - 1]);
    }

    // 无 auto_advance 配置 → 不参与自动推进，升级到人工
    const config = this.getAutoAdvanceConfig(stage);
    if (!config) {
      await this.deps.notifyConsumers(stage.id, "onManualAdvanceRequired", { suggestions });
      return { action: "escalated", reasons: [{ code: "NO_AUTO_ADVANCE_CONFIG", severity: "info", message: "该阶段未配置自动推进" }] };
    }

    // 按 accepted_signal_types 过滤（disagreement 已在上方处理，此处只过滤推进类信号）
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

  /** B3: Decision Mode 校验 — suggestive 模式必须包含 recommendation/reason/alternatives */
  private validateDecisionModes(suggestions: StageTransitionSuggestion[]): EvaluationResult | null {
    for (const s of suggestions) {
      const mode = s.decision_mode as DecisionMode;
      // suggestive + disagreement 是非法组合
      if (mode === "suggestive" && s.signal_type === "disagreement") {
        return { action: "blocked", reasons: [{ code: "INVALID_DECISION_MODE_COMBINATION", severity: "error", message: "decision_mode 'suggestive' 不适用于 disagreement 信号" }] };
      }
      if (mode === "suggestive") {
        if (!s.recommendation) {
          return { action: "blocked", reasons: [{ code: "SUGGESTIVE_MISSING_RECOMMENDATION", severity: "error", message: "suggestive 模式必须包含 recommendation 字段" }] };
        }
        if (!s.reason) {
          return { action: "blocked", reasons: [{ code: "SUGGESTIVE_MISSING_REASON", severity: "error", message: "suggestive 模式必须包含 reason 字段" }] };
        }
        if (!s.alternatives || s.alternatives.length === 0) {
          return { action: "blocked", reasons: [{ code: "SUGGESTIVE_MISSING_ALTERNATIVES", severity: "error", message: "suggestive 模式必须包含 alternatives 字段" }] };
        }
      }
    }
    return null;
  }

  /** 向后兼容：根据字段推断 signal_type。结合 stage.key 防止误路由 */
  private inferSignalType(suggestion: StageTransitionSuggestion, stageKey: string): SignalType {
    if (suggestion.consensus === false || (suggestion.positions && suggestion.positions.length > 0)) {
      return "disagreement";
    }
    // design/review 阶段 + consensus: true → adversarial_consensus（无论 adversarial_artifact 是否存在，让 R1 正确拦截）
    if ((stageKey === "design" || stageKey === "review") && suggestion.consensus === true) {
      return "adversarial_consensus";
    }
    if (suggestion.adversarial_artifact) {
      return "adversarial_consensus";
    }
    return "gate_complete";
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
      return { action: "blocked", reasons: [{ code: "CONTEXT_MISSING", severity: "error", message: "Issue 上下文缺少必要字段", details: { missing_fields: missingContext } }] };
    }
    const latest = suggestions[suggestions.length - 1];
    const failedGates = this.getFailedGates(config, latest);
    if (failedGates.length > 0) {
      return { action: "blocked", reasons: [{ code: "GATE_FAILED", severity: "error", message: `Gate 自检未通过：${failedGates.join(", ")}`, details: { failed_gates: failedGates } }] };
    }
    await this.executeAutoAdvance(stage, latest);
    return { action: "auto_advanced", target_key: latest.target_key, reasons: [{ code: "AUTO_ADVANCED", severity: "info", message: "自动推进成功" }] };
  }

  private async evaluateAdversarialConsensus(stage: Stage, config: AutoAdvanceConfig, consensusSignals: StageTransitionSuggestion[]): Promise<EvaluationResult> {
    const uniqueSpeakers = new Set(consensusSignals.map(s => s.from_speaker));
    if (uniqueSpeakers.size < 2) {
      return { action: "blocked", reasons: [{ code: "SPEAKERS_INSUFFICIENT", severity: "warning", message: `需要 2 个不同 speaker 的共识信号，当前 ${uniqueSpeakers.size} 个`, details: { current_speakers: [...uniqueSpeakers] } }] };
    }

    const missingContext = this.getMissingContextFields(stage, config);
    if (missingContext.length > 0) {
      await this.notifyMissingContext(stage.id, missingContext);
      return { action: "blocked", reasons: [{ code: "CONTEXT_MISSING", severity: "error", message: "Issue 上下文缺少必要字段", details: { missing_fields: missingContext } }] };
    }

    const blockingResult = this.checkBlockingRules(stage, config);
    if (blockingResult) {
      return { action: "blocked", reasons: [{ code: blockingResult, severity: "warning", message: blockingResult === "INCOMPATIBLE_BLOCKED" ? "PR 标题含 [Incompatible]，阻断自动推进" : "阻断规则触发" }] };
    }

    const latestBySpeaker = this.getLatestBySpeaker(consensusSignals, uniqueSpeakers);
    const speakerValidation = this.validateAllSpeakers(stage, config, latestBySpeaker);
    if (speakerValidation.result) return speakerValidation.result;

    const r6Warning = this.checkR6Similarity(latestBySpeaker);
    if (r6Warning) {
      log.warn({ stageId: stage.id }, "R6: cross-speaker verification outputs are suspiciously similar (>80%)");
    }

    const latest = consensusSignals[consensusSignals.length - 1];
    await this.executeAutoAdvance(stage, latest);
    const reasons: EvaluationReason[] = [{ code: "AUTO_ADVANCED", severity: "info", message: "自动推进成功" }];
    if (r6Warning) {
      reasons.push({ code: "R6_SIMILARITY_DETECTED", severity: "warning", message: "两位 agent 的独立验证输出高度相似（>80%），可能存在抄袭" });
    }
    for (const speaker of speakerValidation.r7Warnings) {
      reasons.push({ code: "R7_ALL_CLEAR_WARNING", severity: "warning", message: `${speaker} 的 adversarial_findings 全部为"无问题"` });
    }
    return { action: "auto_advanced", target_key: latest.target_key, reasons };
  }

  private getLatestBySpeaker(consensusSignals: StageTransitionSuggestion[], uniqueSpeakers: Set<string>): Map<string, StageTransitionSuggestion> {
    const latestBySpeaker = new Map<string, StageTransitionSuggestion>();
    for (const speaker of uniqueSpeakers) {
      const speakerSignals = consensusSignals.filter(s => s.from_speaker === speaker);
      latestBySpeaker.set(speaker, speakerSignals[speakerSignals.length - 1]);
    }
    return latestBySpeaker;
  }

  /** 验证所有 speaker 的 gate 和对抗产物，result 为 null 表示全部通过，r7Warnings 收集 allClear 的 speaker */
  private validateAllSpeakers(stage: Stage, config: AutoAdvanceConfig, latestBySpeaker: Map<string, StageTransitionSuggestion>): { result: EvaluationResult | null; r7Warnings: string[] } {
    const r7Warnings: string[] = [];
    for (const [speaker, latest] of latestBySpeaker) {
      const failedGates = this.getFailedGates(config, latest);
      if (failedGates.length > 0) {
        return { result: { action: "blocked", reasons: [{ code: "GATE_FAILED", severity: "error", message: `Gate 自检未通过（${speaker}）：${failedGates.join(", ")}`, details: { failed_gates: failedGates, speaker } }] }, r7Warnings };
      }
      const validation = this.validateAdversarialArtifactWithConfig(stage, config, latest);
      if (!validation.valid) {
        log.warn({ stageId: stage.id, speaker, reason: validation.reason }, "adversarial artifact validation failed");
        const errorCode = validation.rule === "R1_ARTIFACT_MISSING" ? "ADVERSARIAL_ARTIFACT_MISSING" : "ADVERSARIAL_VALIDATION_FAILED";
        return { result: { action: "blocked", reasons: [{ code: errorCode, severity: "error", message: `对抗产物校验失败（${speaker}）：${validation.reason}`, details: { speaker, rule: validation.rule } }] }, r7Warnings };
      }
      if (validation.allClear) {
        log.warn({ stageId: stage.id, speaker }, "adversarial_findings all clear — no issues found");
        r7Warnings.push(speaker);
      }
    }
    return { result: null, r7Warnings };
  }

  /** 从 Issue.sop_snapshot 读取当前 stage 的 auto_advance 配置 */
  private getAutoAdvanceConfig(stage: Stage): AutoAdvanceConfig | undefined {
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

  /** 配置驱动的阻断规则检查（unresolved_findings 由 validateAdversarialArtifactWithConfig 中的 R8 处理） */
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
      // unresolved_findings 在 validateAdversarialArtifactWithConfig 的 R8 中按 config.blocking_rules 驱动
    }
    return null;
  }

  private async executeAutoAdvance(stage: Stage, suggestion: StageTransitionSuggestion): Promise<void> {
    const targetKey = suggestion.target_key;
    const newStage = await this.deps.advanceStage(stage.id, targetKey);
    await this.deps.recordAuditTrail(stage, newStage, suggestion);
    // 使用新 stage.id 通知——确保 board 在新阶段的 agent 调用前正确反映状态
    await this.deps.notifyConsumers(newStage.id, "onAutoAdvanced", {
      from: stage.id, to: newStage.id, from_key: stage.key, to_key: newStage.key, reason: suggestion.reason
    });
  }

  /** 返回未通过的 gate ID 列表（空数组表示全部通过） */
  private getFailedGates(config: AutoAdvanceConfig, suggestion: StageTransitionSuggestion): string[] {
    const gateEvidence = suggestion.gate_evidence ?? {};
    const failed: string[] = [];
    for (const gate of config.gate_ids) {
      const value = gateEvidence[gate];
      if (typeof value !== "string" || !value.trim()) {
        failed.push(gate);
      }
    }
    // rev-04 额外格式校验：值必须是合法的特性编号（F + 8位日期 + 4位随机码）
    if (config.gate_ids.includes("rev-04") && !failed.includes("rev-04")) {
      const rev04 = gateEvidence["rev-04"] as string;
      if (!/^F\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}$/.test(rev04)) {
        failed.push("rev-04");
      }
    }
    return failed;
  }

  /** 保留 allGatesPassed 供外部调用（如测试） */
  allGatesPassed(stage: Stage, suggestion: StageTransitionSuggestion): boolean {
    const config = this.getAutoAdvanceConfig(stage);
    if (!config) return false;
    return this.getFailedGates(config, suggestion).length === 0;
  }

  /** 校验对抗产物的语义内容，返回 { valid, reason, rule, allClear } */
  validateAdversarialArtifact(stage: Stage, suggestion: StageTransitionSuggestion): { valid: boolean; reason?: string; rule?: string; allClear?: boolean } {
    const config = this.getAutoAdvanceConfig(stage);
    return this.validateAdversarialArtifactWithConfig(stage, config, suggestion);
  }

  private validateAdversarialArtifactWithConfig(stage: Stage, config: AutoAdvanceConfig | undefined, suggestion: StageTransitionSuggestion): { valid: boolean; reason?: string; rule?: string; allClear?: boolean } {
    // R1: adversarial_artifact 必须存在
    const artifact = suggestion.adversarial_artifact;
    if (!artifact) {
      return { valid: false, reason: "missing adversarial_artifact", rule: "R1_ARTIFACT_MISSING" };
    }

    // R2: audit_trail 校验
    const auditResult = this.validateAuditTrail(artifact);
    if (auditResult) return { ...auditResult, rule: "R2" };

    // R3: independent_verification 的 actual_output 长度 >= 20 字符
    if (artifact.independent_verification.some(v => v.actual_output.length < 20)) {
      return { valid: false, reason: "independent_verification actual_output too short (< 20 chars)", rule: "R3" };
    }

    // R4/R5: 通过 artifact 字段存在性自动推断，不依赖 stage.key
    const stageResult = this.validateStageSpecificFields(artifact);
    if (stageResult) return stageResult;

    // adversarial_findings 不得为空数组
    if (artifact.adversarial_findings.length === 0) {
      return { valid: false, reason: "adversarial_findings must not be empty", rule: "R1" };
    }

    /**
     * R8: 通过 config.blocking_rules 判断，不依赖 stage.key。
     * 保护场景：防止审查者遗漏处理 findings 就直接推进到 merge。
     */
    if (config?.blocking_rules?.some(r => r.type === "unresolved_findings")) {
      const unresolvedFindings = artifact.adversarial_findings.filter(
        f => f.finding !== "no issues" && (f.disposition === "none" || (f.disposition ?? "").trim() === ""),
      );
      if (unresolvedFindings.length > 0) {
        return { valid: false, reason: `${unresolvedFindings.length} finding(s) with unresolved disposition`, rule: "R8" };
      }
    }

    // R7: adversarial_findings 全部为"无问题"时标记（不阻断）
    const allClear = artifact.adversarial_findings.every(
      f => f.finding === "no issues",
    );

    return { valid: true, allClear };
  }

  private validateAuditTrail(artifact: AdversarialArtifact): { valid: false; reason: string } | null {
    const reviewStarted = artifact.audit_trail.events.find(e => e.event_type === 'review_started');
    const crossReviewRead = artifact.audit_trail.events.find(e => e.event_type === 'cross_review_read');
    if (!crossReviewRead) {
      return { valid: false, reason: "audit_trail missing cross_review_read event" };
    }
    if (reviewStarted && crossReviewRead.timestamp <= reviewStarted.timestamp) {
      return { valid: false, reason: "audit_trail cross_review_read timestamp must be after review_started" };
    }
    return null;
  }

  /**
   * R4/R5: 通过 artifact 字段存在性推断。
   * 设计阶段：若 artifact 缺少 critique_obligation 或 items < 4 → R4 失败。
   * 审查阶段：若 artifact 缺少 file_coverage 或 coverage_ratio ≠ 1.0 → R5 失败。
   */
  private validateStageSpecificFields(
    artifact: AdversarialArtifact | DesignAdversarialArtifact | ReviewAdversarialArtifact,
  ): { valid: boolean; reason?: string; rule?: string } | null {
    const isDesignArtifact = "critique_obligation" in artifact || "independent_analysis" in artifact || "scenario_coverage" in artifact;
    if (isDesignArtifact) {
      if (!this.isValidDesignArtifact(artifact)) {
        return { valid: false, reason: "design stage requires critique_obligation.items >= 4", rule: "R4" };
      }
    }

    const isReviewArtifact = "file_coverage" in artifact || "file_dispositions" in artifact || "cross_review" in artifact || "ci_independence" in artifact;
    if (isReviewArtifact) {
      if (!this.isValidReviewArtifact(artifact)) {
        return { valid: false, reason: "review stage requires file_coverage.coverage_ratio = 1.0", rule: "R5" };
      }
    }

    return null;
  }

  private isValidDesignArtifact(artifact: AdversarialArtifact | DesignAdversarialArtifact): boolean {
    return "critique_obligation" in artifact &&
      !!artifact.critique_obligation &&
      Array.isArray(artifact.critique_obligation.items) &&
      artifact.critique_obligation.items.length >= 4;
  }

  private isValidReviewArtifact(artifact: AdversarialArtifact | ReviewAdversarialArtifact): boolean {
    return "file_coverage" in artifact &&
      !!artifact.file_coverage &&
      typeof artifact.file_coverage.coverage_ratio === "number" &&
      artifact.file_coverage.coverage_ratio === 1.0;
  }

  /** R6: 检测跨 speaker 的 independent_verification 输出是否雷同（相似度 > 80%）。返回 true 表示检测到雷同 */
  private checkR6Similarity(latestBySpeaker: Map<string, StageTransitionSuggestion>): boolean {
    const speakers = [...latestBySpeaker.keys()];
    if (speakers.length < 2) return false;

    const outputs = speakers.map(speaker => {
      const artifact = latestBySpeaker.get(speaker)!.adversarial_artifact;
      if (!artifact) return [];
      return artifact.independent_verification.map(v => v.actual_output);
    });

    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        if (this.isSimilar(outputs[i], outputs[j])) return true;
      }
    }
    return false;
  }

  private isSimilar(outputsA: string[], outputsB: string[]): boolean {
    if (outputsA.length === 0 || outputsB.length === 0) return false;
    for (const a of outputsA) {
      for (const b of outputsB) {
        if (this.stringSimilarity(a, b) > 0.8) return true;
      }
    }
    return false;
  }

  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    const lcsLength = this.lcsLength(longer, shorter);
    return lcsLength / longer.length;
  }

  private lcsLength(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    let prev = new Array<number>(n + 1).fill(0);
    let curr = new Array<number>(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
      }
      [prev, curr] = [curr, prev];
      curr.fill(0);
    }
    return prev[n];
  }
}
