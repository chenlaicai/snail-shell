import type { CreateIssueInput, Issue, Stage } from "@domain/issue/model";
import type { StageAuditRecord } from "@domain/issue/port";
import type { Message, MessageContext, MessageEvent } from "@domain/message/model";

// ── 信号与决策 ─────────────────────────────────────────────────────────

export type SignalType = "gate_complete" | "adversarial_consensus" | "disagreement";

export type DecisionMode = "autonomous" | "suggestive" | "requires_human";

export interface Position {
  speaker: string;
  stance: "for" | "against" | "neutral";
  argument: string;
  evidence?: string;
}

export interface AdversarialArtifact {
  independent_verification: {
    command: string;
    actual_output: string;
    executed_at: string;
  }[];
  adversarial_findings: {
    dimension: string;
    finding: string;
    disposition: string;
  }[];
  audit_trail: {
    events: {
      timestamp: string;
      event_type: 'review_started' | 'cross_review_read' | 'disagreement_found' | 'consensus_reached';
      detail: string;
    }[];
  };
}

// ── 引擎评估 ───────────────────────────────────────────────────────────

export type EvaluationAction = "auto_advanced" | "blocked" | "escalated";

export interface EvaluationReason {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
}

export interface EvaluationResult {
  action: EvaluationAction;
  target_key?: string;
  reasons: EvaluationReason[];
}

// ── Stage 转换建议 ─────────────────────────────────────────────────────

export interface StageTransitionSuggestion {
  stage_id: string;
  message_id: number;
  from_speaker: string;
  target_key: string;
  reason: string;
  guard: string | null;
  artifacts: Record<string, string>;
  created_at: string;
  signal_type?: SignalType;
  decision_mode?: DecisionMode;
  consensus?: boolean;
  positions?: Position[];
  review_round?: number;
  gate_evidence?: Record<string, unknown>;
  adversarial_artifact?: AdversarialArtifact;
  recommendation?: string;
  alternatives?: string[];
  dismiss_count?: number;
}

// ── Issue 关闭结果 ─────────────────────────────────────────────────────

export interface CloseIssueResult {
  issue: Issue;
  cleanup: CleanupResult;
}

export interface CleanupResult {
  pr: { status: "success" | "failed" | "skipped" | "merged" | "closed"; error?: string };
  worktree: { status: "success" | "failed" | "skipped"; error?: string };
  localBranch: { status: "success" | "failed" | "skipped"; error?: string };
  remoteBranch: { status: "success" | "failed" | "skipped"; error?: string };
}

// ── Collaboration 端口 ─────────────────────────────────────────────────
// infra 层通过此端口与 issue-collaboration 交互，禁止直接导入 @app/*

export interface CollaborationPort {
  createIssue(input: CreateIssueInput): Promise<{ issue: Issue; stage: Stage }>;
  sendMessage(stageId: string, text: string, fromSpeaker?: string, toSpeakers?: string[]): Promise<void>;
  interruptMessage(messageId: number): Promise<boolean>;
  registerIssueConsumer(issueId: string, consumer: CollaborationConsumer): void;
  unregisterIssueConsumer(issueId: string, consumer: CollaborationConsumer): void;
  registerWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void;
  unregisterWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void;
  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[];
  dismissSuggestion(stageId: string, targetKey: string, createdAt: string): boolean;
  advanceStage(stageId: string, targetKey: string): Promise<Stage>;
  evaluateAdvance(stageId: string): Promise<EvaluationResult>;
  rollbackStage(stageId: string, targetKey: string): Promise<Stage>;
  getStageAuditTrail(stageId: string): StageAuditRecord[];
  closeIssue(issueId: string): Promise<CloseIssueResult>;
  isInvoking(stageId: string): boolean;
  getActivityStatus(stageId: string, issueClosedAt?: string | null): "ai_running" | "needs_human" | "completed";
  resumeRoute(stageId: string, message: Message): Promise<void>;
}

// ── WebSocket Consumer ─────────────────────────────────────────────────

export interface CollaborationConsumer {
  onMessageStarted?(stageId: string, message: Message): void | Promise<void>;
  onEvent(stageId: string, event: MessageEvent): void | Promise<void>;
  onMessageCompleted(stageId: string, message: Message, context: MessageContext | null): void | Promise<void>;
  onUserCalled(stageId: string, message: Message): void | Promise<void>;
  onStageTransitionSuggested?(stageId: string, suggestion: StageTransitionSuggestion): void | Promise<void>;
  onMergeReady?(stageId: string, data: { suggestions: StageTransitionSuggestion[] }): void | Promise<void>;
  onDisagreement?(stageId: string, suggestion: StageTransitionSuggestion): void | Promise<void>;
  onAutoAdvanced?(stageId: string, data: { from: string; to: string; from_key: string; to_key: string; reason: string }): void | Promise<void>;
  onContextMissing?(stageId: string, data: { missing_fields: string[] }): void | Promise<void>;
  onEvaluationResult?(stageId: string, result: EvaluationResult): void | Promise<void>;
  onCleanupCompleted?(issueId: string, cleanup: CleanupResult): void | Promise<void>;
}

export interface WorkspaceConsumer {
  onActivityStatusChanged(issueId: string, activityStatus: "ai_running" | "needs_human" | "completed", previousStatus: "ai_running" | "needs_human" | "completed"): void;
}
