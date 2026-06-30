import type { Stage } from "@domain/issue/model";
import type { StageTransitionSuggestion, AdversarialArtifact, DesignAdversarialArtifact, ReviewAdversarialArtifact, SignalType, EvaluationResult, EvaluationReason } from "@app/issue-collaboration/port";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "auto-advance" });

export interface AutoAdvanceDeps {
  advanceStage(stageId: string, targetKey: string): Promise<Stage>;
  recordAuditTrail(fromStage: Stage, toStage: Stage, suggestion: StageTransitionSuggestion): Promise<void>;
  notifyConsumers(stageId: string, method: string, ...args: unknown[]): Promise<void>;
  generateDisagreementCard(stageId: string, suggestion: StageTransitionSuggestion): Promise<void>;
  mustGetIssue(issueId: string): { context: Record<string, string> };
}

export class AutoAdvanceEngine {
  constructor(private readonly deps: AutoAdvanceDeps) {}

  async evaluate(stage: Stage, suggestions: StageTransitionSuggestion[]): Promise<EvaluationResult> {
    if (suggestions.length === 0) {
      return { action: "blocked", reasons: [{ code: "NO_SIGNALS", severity: "info", message: "无信号" }] };
    }

    // merge 阶段不自动推进
    if (stage.available_transitions.some(t => t.to === "merge")) {
      await this.deps.notifyConsumers(stage.id, "onMergeReady", { suggestions });
      return { action: "escalated", reasons: [{ code: "MERGE_REQUIRES_HUMAN", severity: "info", message: "merge 阶段需人工执行" }] };
    }

    // 按 signal_type 路由（向后兼容：推断 signal_type）
    const typedSuggestions = suggestions.map(s => ({
      ...s,
      signal_type: s.signal_type ?? this.inferSignalType(s, stage.key),
    }));

    // 分歧信号优先处理
    const disagreements = typedSuggestions.filter(s => s.signal_type === "disagreement");
    if (disagreements.length > 0) {
      return await this.handleDisagreement(stage.id, disagreements[disagreements.length - 1]);
    }

    // gate_complete 路由（单人阶段）
    const gateCompletes = typedSuggestions.filter(s => s.signal_type === "gate_complete");
    if (gateCompletes.length > 0 && stage.key === "development") {
      return await this.evaluateGateComplete(stage, gateCompletes);
    }

    // adversarial_consensus 路由（多人阶段）
    const consensusSignals = typedSuggestions.filter(s => s.signal_type === "adversarial_consensus");
    if (consensusSignals.length > 0) {
      return await this.evaluateAdversarialConsensus(stage, consensusSignals);
    }

    return { action: "blocked", reasons: [{ code: "NO_VALID_SIGNALS", severity: "info", message: "无有效信号" }] };
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

  private async evaluateGateComplete(stage: Stage, suggestions: StageTransitionSuggestion[]): Promise<EvaluationResult> {
    const missingContext = this.getMissingContextFields(stage);
    if (missingContext.length > 0) {
      await this.notifyMissingContext(stage.id, missingContext);
      return { action: "blocked", reasons: [{ code: "CONTEXT_MISSING", severity: "error", message: "Issue 上下文缺少必要字段", details: { missing_fields: missingContext } }] };
    }
    const latest = suggestions[suggestions.length - 1];
    const failedGates = this.getFailedGates(stage, latest);
    if (failedGates.length > 0) {
      return { action: "blocked", reasons: [{ code: "GATE_FAILED", severity: "error", message: `Gate 自检未通过：${failedGates.join(", ")}`, details: { failed_gates: failedGates } }] };
    }
    await this.executeAutoAdvance(stage, latest);
    return { action: "auto_advanced", target_key: latest.target_key, reasons: [{ code: "AUTO_ADVANCED", severity: "info", message: "自动推进成功" }] };
  }

  private async evaluateAdversarialConsensus(stage: Stage, consensusSignals: StageTransitionSuggestion[]): Promise<EvaluationResult> {
    const uniqueSpeakers = new Set(consensusSignals.map(s => s.from_speaker));
    if (uniqueSpeakers.size < 2) {
      return { action: "blocked", reasons: [{ code: "SPEAKERS_INSUFFICIENT", severity: "warning", message: `需要 2 个不同 speaker 的共识信号，当前 ${uniqueSpeakers.size} 个`, details: { current_speakers: [...uniqueSpeakers] } }] };
    }

    const missingContext = this.getMissingContextFields(stage);
    if (missingContext.length > 0) {
      await this.notifyMissingContext(stage.id, missingContext);
      return { action: "blocked", reasons: [{ code: "CONTEXT_MISSING", severity: "error", message: "Issue 上下文缺少必要字段", details: { missing_fields: missingContext } }] };
    }

    if (this.isIncompatibleBlocked(stage)) {
      return { action: "blocked", reasons: [{ code: "INCOMPATIBLE_BLOCKED", severity: "warning", message: "PR 标题含 [Incompatible]，阻断自动推进" }] };
    }

    const latestBySpeaker = this.getLatestBySpeaker(consensusSignals, uniqueSpeakers);
    const speakerValidation = this.validateAllSpeakers(stage, latestBySpeaker);
    if (speakerValidation) return speakerValidation;

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

  /** 验证所有 speaker 的 gate 和对抗产物，返回 null 表示全部通过 */
  private validateAllSpeakers(stage: Stage, latestBySpeaker: Map<string, StageTransitionSuggestion>): EvaluationResult | null {
    for (const [speaker, latest] of latestBySpeaker) {
      const failedGates = this.getFailedGates(stage, latest);
      if (failedGates.length > 0) {
        return { action: "blocked", reasons: [{ code: "GATE_FAILED", severity: "error", message: `Gate 自检未通过（${speaker}）：${failedGates.join(", ")}`, details: { failed_gates: failedGates, speaker } }] };
      }
      const validation = this.validateAdversarialArtifact(stage, latest);
      if (!validation.valid) {
        log.warn({ stageId: stage.id, speaker, reason: validation.reason }, "adversarial artifact validation failed");
        const errorCode = validation.rule === "R1_ARTIFACT_MISSING" ? "ADVERSARIAL_ARTIFACT_MISSING" : "ADVERSARIAL_VALIDATION_FAILED";
        return { action: "blocked", reasons: [{ code: errorCode, severity: "error", message: `对抗产物校验失败（${speaker}）：${validation.reason}`, details: { speaker, rule: validation.rule } }] };
      }
      if (validation.allClear) {
        log.warn({ stageId: stage.id, speaker }, "adversarial_findings all clear — no issues found");
      }
    }
    return null;
  }

  /** 各 stage 推进所需的 Issue.context 必要字段 */
  private static readonly REQUIRED_CONTEXT_FIELDS: Record<string, string[]> = {
    design: ["worktree_path", "branch_name"],
    development: ["worktree_path", "branch_name", "pr_url"],
    review: ["pr_url"],
  };

  private getMissingContextFields(stage: Stage): string[] {
    const requiredFields = AutoAdvanceEngine.REQUIRED_CONTEXT_FIELDS[stage.key];
    if (!requiredFields) return [];
    const issue = this.deps.mustGetIssue(stage.issue_id);
    return requiredFields.filter(field => !issue.context[field]?.trim());
  }

  private async notifyMissingContext(stageId: string, missingFields: string[]): Promise<void> {
    log.warn({ stageId, missingFields }, "auto-advance blocked: missing context fields");
    await this.deps.notifyConsumers(stageId, "onContextMissing", { missing_fields: missingFields });
  }

  private isIncompatibleBlocked(stage: Stage): boolean {
    if (stage.key !== "review") return false;
    const issue = this.deps.mustGetIssue(stage.issue_id);
    const prTitle = issue.context["pr_title"] ?? "";
    if (prTitle.includes("[Incompatible]")) {
      log.info({ stageId: stage.id }, "[Incompatible] tag blocks auto-advance");
      return true;
    }
    return false;
  }

  private async executeAutoAdvance(stage: Stage, suggestion: StageTransitionSuggestion): Promise<void> {
    const targetKey = suggestion.target_key;
    const newStage = await this.deps.advanceStage(stage.id, targetKey);
    await this.deps.recordAuditTrail(stage, newStage, suggestion);
    await this.deps.notifyConsumers(stage.id, "onAutoAdvanced", {
      from: stage.key, to: newStage.key, reason: suggestion.reason
    });
  }

  /** 返回未通过的 gate ID 列表（空数组表示全部通过） */
  private getFailedGates(stage: Stage, suggestion: StageTransitionSuggestion): string[] {
    const stageKey = stage.key;
    const gateEvidence = suggestion.gate_evidence ?? {};
    switch (stageKey) {
      case "design": return this.getFailedDesignGates(gateEvidence);
      case "development": return this.getFailedDevGates(gateEvidence);
      case "review": return this.getFailedReviewGates(gateEvidence);
      default: return ["unknown_stage"];
    }
  }

  private getFailedDesignGates(evidence: Record<string, unknown>): string[] {
    const failed: string[] = [];
    for (const gate of ["design-01", "design-02"]) {
      const value = evidence[gate];
      if (typeof value !== "string" || !value.trim()) failed.push(gate);
    }
    return failed;
  }

  private getFailedDevGates(evidence: Record<string, unknown>): string[] {
    const failed: string[] = [];
    for (const gate of ["dev-01", "dev-02", "dev-03", "dev-04", "dev-06"]) {
      const value = evidence[gate];
      if (typeof value !== "string" || !value.trim()) failed.push(gate);
    }
    return failed;
  }

  private getFailedReviewGates(evidence: Record<string, unknown>): string[] {
    const failed: string[] = [];
    for (const gate of ["rev-01", "rev-02", "rev-03"]) {
      const value = evidence[gate];
      if (typeof value !== "string" || !value.trim()) failed.push(gate);
    }
    return failed;
  }

  /** 保留 allGatesPassed 供外部调用（如测试） */
  allGatesPassed(stage: Stage, suggestion: StageTransitionSuggestion): boolean {
    return this.getFailedGates(stage, suggestion).length === 0;
  }

  /** 校验对抗产物的语义内容，返回 { valid, reason, rule, allClear } */
  validateAdversarialArtifact(stage: Stage, suggestion: StageTransitionSuggestion): { valid: boolean; reason?: string; rule?: string; allClear?: boolean } {
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

    // R4/R5: 阶段特有字段
    const stageResult = this.validateStageSpecificFields(stage, artifact);
    if (stageResult) return { ...stageResult, rule: stage.key === "design" ? "R4" : "R5" };

    // adversarial_findings 不得为空数组
    if (artifact.adversarial_findings.length === 0) {
      return { valid: false, reason: "adversarial_findings must not be empty", rule: "R1" };
    }

    // R7: adversarial_findings 全部为"无问题"时标记（不阻断）
    const allClear = artifact.adversarial_findings.every(
      f => f.finding === "no issues" || f.disposition === "none",
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

  private validateStageSpecificFields(
    stage: Stage,
    artifact: AdversarialArtifact | DesignAdversarialArtifact | ReviewAdversarialArtifact,
  ): { valid: false; reason: string } | null {
    if (stage.key === "design" && !this.hasDesignFields(artifact)) {
      return { valid: false, reason: "design stage requires critique_obligation.items >= 4" };
    }
    if (stage.key === "review" && !this.hasReviewFields(artifact)) {
      return { valid: false, reason: "review stage requires file_coverage.coverage_ratio = 1.0" };
    }
    return null;
  }

  private hasDesignFields(artifact: AdversarialArtifact | DesignAdversarialArtifact): artifact is DesignAdversarialArtifact {
    return "critique_obligation" in artifact &&
      !!artifact.critique_obligation &&
      Array.isArray(artifact.critique_obligation.items) &&
      artifact.critique_obligation.items.length >= 4;
  }

  private hasReviewFields(artifact: AdversarialArtifact | ReviewAdversarialArtifact): artifact is ReviewAdversarialArtifact {
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
