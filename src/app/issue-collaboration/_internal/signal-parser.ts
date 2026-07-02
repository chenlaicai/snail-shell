import type { MessageEvent } from "@domain/message/model";
import type { MessagePort } from "@domain/message/port";
import type { Stage } from "@domain/issue/model";
import type { AdversarialArtifact, DecisionMode, Position, SignalType, StageTransitionSuggestion } from "@app/issue-collaboration/port";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "signal-parser" });

export interface SignalParserDeps {
  messagePort: Pick<MessagePort, "getMessageEvents">;
}

type TransitionPayload = {
  targetKey: string;
  reason: unknown;
  guard: unknown;
  signal_type?: SignalType;
  decision_mode?: DecisionMode;
  consensus?: boolean;
  positions?: Position[];
  gate_evidence?: Record<string, unknown>;
  adversarial_artifact?: AdversarialArtifact;
  recommendation?: string;
  alternatives?: string[];
};

type ParsedTransition = {
  target_key?: string;
  reason?: string;
  guard?: string | null;
  signal_type?: string;
  decision_mode?: string;
  consensus?: boolean;
  positions?: Position[];
  gate_evidence?: Record<string, unknown>;
  adversarial_artifact?: AdversarialArtifact;
  recommendation?: string;
  alternatives?: string[];
};

/**
 * 阶段转换信号解析器：从消息事件中提取 stage_transition 信号并构建建议。
 * 纯解析职责：遍历事件 → 提取 payload → 构建建议。状态管理由主类负责。
 */
export class StageTransitionSignalParser {
  constructor(private readonly deps: SignalParserDeps) {}

  /** 从消息中提取阶段转换建议，返回 null 表示无信号 */
  extract(stage: Stage, roleInstance: string, messageId: number): StageTransitionSuggestion | null {
    for (const event of this.deps.messagePort.getMessageEvents(messageId)) {
      const payload = this.extractSignalPayload(event, stage);
      if (payload) return this.makeStageTransitionSuggestion({ stage, roleInstance, messageId, ...payload });
    }
    return null;
  }

  private extractSignalPayload(event: MessageEvent, stage: Stage): TransitionPayload | null {
    if (event.payload.type === "signal" && typeof event.payload.stage_transition === "object" && event.payload.stage_transition) {
      return this.extractFromSignalPayload(event.payload.stage_transition as Record<string, unknown>, stage);
    }
    if (event.payload.type === "text") {
      return this.extractFromTextPayload(event.payload.text, stage);
    }
    return null;
  }

  private extractFromSignalPayload(payload: Record<string, unknown>, stage: Stage): TransitionPayload | null {
    const targetKey = String(payload.target_key ?? payload.to ?? "");
    if (!targetKey || !stage.available_transitions.some(t => t.to === targetKey)) return null;
    return { targetKey, ...this.buildTransitionPayload(payload) };
  }

  private extractFromTextPayload(text: string, stage: Stage): TransitionPayload | null {
    const parsed = this.tryParseStageTransition(text);
    if (!parsed?.target_key || !stage.available_transitions.some(t => t.to === parsed.target_key)) return null;
    return { targetKey: parsed.target_key, ...this.buildTransitionPayload(parsed as Record<string, unknown>) };
  }

  private buildTransitionPayload(raw: Record<string, unknown>): Omit<TransitionPayload, "targetKey"> {
    return {
      reason: raw.reason, guard: raw.guard,
      signal_type: typeof raw.signal_type === "string" ? raw.signal_type as SignalType : undefined,
      decision_mode: typeof raw.decision_mode === "string" ? raw.decision_mode as DecisionMode : undefined,
      consensus: typeof raw.consensus === "boolean" ? raw.consensus : undefined,
      positions: Array.isArray(raw.positions) ? raw.positions as Position[] : undefined,
      gate_evidence: typeof raw.gate_evidence === "object" ? raw.gate_evidence as Record<string, unknown> : undefined,
      adversarial_artifact: typeof raw.adversarial_artifact === "object" ? raw.adversarial_artifact as AdversarialArtifact : undefined,
      recommendation: typeof raw.recommendation === "string" ? raw.recommendation : undefined,
      alternatives: Array.isArray(raw.alternatives) ? raw.alternatives as string[] : undefined,
    };
  }

  private makeStageTransitionSuggestion(input: { stage: Stage; roleInstance: string; messageId: number } & TransitionPayload): StageTransitionSuggestion {
    const { stage, roleInstance, messageId, targetKey, reason, guard, signal_type, decision_mode, consensus, positions, gate_evidence, adversarial_artifact, recommendation, alternatives } = input;
    const transition = stage.available_transitions.find(item => item.to === targetKey);
    return {
      stage_id: stage.id, message_id: messageId, from_speaker: roleInstance, target_key: targetKey,
      reason: typeof reason === "string" ? reason : "", guard: typeof guard === "string" ? guard : transition?.guard ?? null,
      artifacts: { ...stage.output_artifacts }, created_at: new Date().toISOString(),
      signal_type, decision_mode, consensus, positions, gate_evidence, adversarial_artifact, recommendation, alternatives,
    };
  }

  private tryParseStageTransition(text: string): ParsedTransition | null {
    try {
      const parsed = JSON.parse(text) as { stage_transition?: ParsedTransition };
      return parsed.stage_transition ?? null;
    } catch {
      log.debug({ textLength: text.length }, "stage_transition.parse.skipped");
      return null;
    }
  }
}
