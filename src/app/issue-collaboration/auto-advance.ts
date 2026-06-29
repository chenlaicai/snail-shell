import type { Stage } from "@domain/issue/model";
import type { StageTransitionSuggestion } from "@app/issue-collaboration/port";
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
    const gateComplete = suggestions.find(s => s.consensus === undefined && s.gate_evidence);
    if (!gateComplete || !this.allGatesPassed(stage, gateComplete)) return;
    await this.executeAutoAdvance(stage, gateComplete);
  }

  private async evaluateAdversarialAutoAdvance(stage: Stage, suggestions: StageTransitionSuggestion[]): Promise<void> {
    const consensusSignals = suggestions.filter(s => s.consensus === true);
    const uniqueSpeakers = new Set(consensusSignals.map(s => s.from_speaker));
    if (uniqueSpeakers.size < 2) return;

    // [Incompatible] 检查
    if (this.isIncompatibleBlocked(stage)) return;

    // 验证每个 speaker 的最新 consensus 信号都包含有效 gate_evidence
    for (const speaker of uniqueSpeakers) {
      const speakerSignals = consensusSignals.filter(s => s.from_speaker === speaker);
      const latest = speakerSignals[speakerSignals.length - 1];
      if (!this.allGatesPassed(stage, latest)) return;
    }

    const latest = consensusSignals[consensusSignals.length - 1];
    await this.executeAutoAdvance(stage, latest);
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
}
