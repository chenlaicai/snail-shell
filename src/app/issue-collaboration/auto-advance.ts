import type { Stage } from "@domain/issue/model";
import type { StageTransitionSuggestion, AdversarialArtifact } from "@app/issue-collaboration/port";
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

  async evaluate(stage: Stage, suggestions: StageTransitionSuggestion[]): Promise<void> {
    if (suggestions.length === 0) return;

    // merge 阶段不自动推进
    if (stage.available_transitions.some(t => t.to === "merge")) {
      await this.deps.notifyConsumers(stage.id, "onMergeReady", { suggestions });
      return;
    }

    // 检查是否有分歧信号
    const disagreement = suggestions.find(s => s.consensus === false);
    if (disagreement) {
      await this.handleDisagreement(stage.id, disagreement);
      return;
    }

    // development stage：单人完成，只需 gate_complete 信号
    if (stage.key === "development") {
      await this.evaluateDevelopmentAutoAdvance(stage, suggestions);
      return;
    }

    // design/review stage：对抗机制，需要两个不同 agent 的共识
    await this.evaluateAdversarialAutoAdvance(stage, suggestions);
  }

  private async handleDisagreement(stageId: string, disagreement: StageTransitionSuggestion): Promise<void> {
    const reviewRound = (disagreement.review_round ?? 0) + 1;
    disagreement.review_round = reviewRound;
    await this.deps.generateDisagreementCard(stageId, disagreement);
    if (reviewRound > 1) {
      log.warn({ stageId, reviewRound }, "review round exceeds threshold");
    }
  }

  private async evaluateDevelopmentAutoAdvance(stage: Stage, suggestions: StageTransitionSuggestion[]): Promise<void> {
    /** 前置条件：校验 Issue.context 必要字段存在性，缺失时阻断自动推进 */
    const missingContext = this.getMissingContextFields(stage);
    if (missingContext.length > 0) {
      await this.notifyMissingContext(stage.id, missingContext);
      return;
    }
    const gateComplete = suggestions.find(s => s.consensus === undefined && s.gate_evidence);
    if (!gateComplete || !this.allGatesPassed(stage, gateComplete)) return;
    await this.executeAutoAdvance(stage, gateComplete);
  }

  private async evaluateAdversarialAutoAdvance(stage: Stage, suggestions: StageTransitionSuggestion[]): Promise<void> {
    const consensusSignals = suggestions.filter(s => s.consensus === true);
    const uniqueSpeakers = new Set(consensusSignals.map(s => s.from_speaker));
    if (uniqueSpeakers.size < 2) return;

    /** 前置条件：校验 Issue.context 必要字段存在性，缺失时阻断自动推进 */
    const missingContext = this.getMissingContextFields(stage);
    if (missingContext.length > 0) {
      await this.notifyMissingContext(stage.id, missingContext);
      return;
    }

    // [Incompatible] 检查
    if (this.isIncompatibleBlocked(stage)) return;

    // 验证每个 speaker 的最新 consensus 信号都包含有效 gate_evidence
    for (const speaker of uniqueSpeakers) {
      const speakerSignals = consensusSignals.filter(s => s.from_speaker === speaker);
      const latest = speakerSignals[speakerSignals.length - 1];
      if (!this.allGatesPassed(stage, latest)) return;
    }

    // 验证对抗产物
    const latestBySpeaker = new Map<string, StageTransitionSuggestion>();
    for (const speaker of uniqueSpeakers) {
      const speakerSignals = consensusSignals.filter(s => s.from_speaker === speaker);
      const latest = speakerSignals[speakerSignals.length - 1];
      latestBySpeaker.set(speaker, latest);
      const validation = this.validateAdversarialArtifact(stage, latest);
      if (!validation.valid) {
        log.warn({ stageId: stage.id, speaker, reason: validation.reason }, "adversarial artifact validation failed");
        await this.deps.notifyConsumers(stage.id, "onDisagreement", latest);
        return;
      }
      // R7: adversarial_findings 全部为"无问题"时告警（不阻断）
      if (validation.allClear) {
        log.warn({ stageId: stage.id, speaker }, "adversarial_findings all clear — no issues found");
        await this.deps.notifyConsumers(stage.id, "onDisagreement", { ...latest, _warning: "adversarial_findings_all_clear" });
      }
    }

    // R6: 跨 speaker independent_verification 输出雷同检测
    if (this.hasSimilarVerificationOutputs(latestBySpeaker)) {
      log.warn({ stageId: stage.id }, "R6: cross-speaker verification outputs are suspiciously similar (>80%)");
      return;
    }

    const latest = consensusSignals[consensusSignals.length - 1];
    await this.executeAutoAdvance(stage, latest);
  }

  /** 各 stage 推进所需的 Issue.context 必要字段 */
  private static readonly REQUIRED_CONTEXT_FIELDS: Record<string, string[]> = {
    design: ["worktree_path", "branch_name"],
    development: ["worktree_path", "branch_name", "pr_url"],
    review: ["pr_url"],
  };

  /** 校验 Issue.context 中必要字段是否存在，返回缺失字段列表 */
  private getMissingContextFields(stage: Stage): string[] {
    const requiredFields = AutoAdvanceEngine.REQUIRED_CONTEXT_FIELDS[stage.key];
    if (!requiredFields) return [];
    const issue = this.deps.mustGetIssue(stage.issue_id);
    return requiredFields.filter(field => !issue.context[field]?.trim());
  }

  /** 通知消费者 context 字段缺失，阻断自动推进 */
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

  allGatesPassed(stage: Stage, suggestion: StageTransitionSuggestion): boolean {
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
    const design01 = evidence["design-01"];
    const design02 = evidence["design-02"];
    return typeof design01 === "string" && design01.trim().length > 0 &&
           typeof design02 === "string" && design02.trim().length > 0;
  }

  private checkDevGates(evidence: Record<string, unknown>): boolean {
    const requiredGates = ["dev-01", "dev-02", "dev-03", "dev-04", "dev-06"];
    return requiredGates.every(gate => {
      const value = evidence[gate];
      return typeof value === "string" && value.trim().length > 0;
    });
  }

  private checkReviewGates(evidence: Record<string, unknown>): boolean {
    const requiredGates = ["rev-01", "rev-02", "rev-03"];
    return requiredGates.every(gate => {
      const value = evidence[gate];
      return typeof value === "string" && value.trim().length > 0;
    });
  }

  /** 校验对抗产物的语义内容，返回 { valid, reason, allClear } */
  validateAdversarialArtifact(stage: Stage, suggestion: StageTransitionSuggestion): { valid: boolean; reason?: string; allClear?: boolean } {
    const artifact = suggestion.adversarial_artifact;
    if (!artifact) {
      return { valid: false, reason: "missing adversarial_artifact" };
    }

    const auditResult = this.validateAuditTrail(artifact);
    if (auditResult) return auditResult;

    // R3: independent_verification 的 actual_output 长度 >= 20 字符
    if (artifact.independent_verification.some(v => v.actual_output.length < 20)) {
      return { valid: false, reason: "independent_verification actual_output too short (< 20 chars)" };
    }

    const stageResult = this.validateStageSpecificFields(stage, artifact);
    if (stageResult) return stageResult;

    // R7: adversarial_findings 全部为"无问题"时标记（不阻断）
    const allClear = artifact.adversarial_findings.length > 0 &&
      artifact.adversarial_findings.every(f => f.finding === "no issues" || f.disposition === "none");

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

  private validateStageSpecificFields(stage: Stage, artifact: AdversarialArtifact): { valid: false; reason: string } | null {
    if (stage.key === "design") {
      const designArtifact = artifact as unknown as Record<string, unknown>;
      const co = designArtifact["critique_obligation"] as Record<string, unknown> | undefined;
      if (!co || !Array.isArray(co["items"]) || (co["items"] as unknown[]).length < 4) {
        return { valid: false, reason: "design stage requires critique_obligation.items >= 4" };
      }
    }
    if (stage.key === "review") {
      const reviewArtifact = artifact as unknown as Record<string, unknown>;
      const fc = reviewArtifact["file_coverage"] as Record<string, unknown> | undefined;
      if (!fc || typeof fc["coverage_ratio"] !== "number" || fc["coverage_ratio"] !== 1.0) {
        return { valid: false, reason: "review stage requires file_coverage.coverage_ratio = 1.0" };
      }
    }
    return null;
  }

  /** R6: 检测跨 speaker 的 independent_verification 输出是否雷同（相似度 > 80%） */
  private hasSimilarVerificationOutputs(latestBySpeaker: Map<string, StageTransitionSuggestion>): boolean {
    const speakers = [...latestBySpeaker.keys()];
    if (speakers.length < 2) return false;

    const outputs = speakers.map(speaker => {
      const artifact = latestBySpeaker.get(speaker)!.adversarial_artifact;
      if (!artifact) return [];
      return artifact.independent_verification.map(v => v.actual_output);
    });

    // 两两比较
    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        if (this.isSimilar(outputs[i], outputs[j])) return true;
      }
    }
    return false;
  }

  /** 计算两组输出的相似度，任一对 > 80% 即视为雷同 */
  private isSimilar(outputsA: string[], outputsB: string[]): boolean {
    if (outputsA.length === 0 || outputsB.length === 0) return false;
    for (const a of outputsA) {
      for (const b of outputsB) {
        if (this.stringSimilarity(a, b) > 0.8) return true;
      }
    }
    return false;
  }

  /** 简单字符串相似度：公共字符数 / 较长字符串长度 */
  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    // 使用 LCS 长度 / 较长字符串长度
    const lcsLength = this.lcsLength(longer, shorter);
    return lcsLength / longer.length;
  }

  /** 最长公共子序列长度 */
  private lcsLength(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    // 空间优化：只保留两行
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
