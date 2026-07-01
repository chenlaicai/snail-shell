import type { Message, MessageContext, MessageEvent } from "@domain/message/model";
import type { CreateIssueInput, Issue, Stage } from "@domain/issue/model";
import type { StageAuditRecord } from "@domain/issue/port";
import type { CleanupResult } from "@app/issue-collaboration/resource-cleanup";

export interface CreateIssueResult {
  issue: Issue;
  stage: Stage;
}

/** 信号类型：显式声明信号语义，引擎按类型路由 */
export type SignalType = "gate_complete" | "adversarial_consensus" | "disagreement";

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

export interface DesignAdversarialArtifact extends AdversarialArtifact {
  critique_obligation: {
    items: { type: 'risk' | 'gap' | 'alternative'; content: string }[];
  };
  independent_analysis: {
    my_conclusion: string;
    comparison_with_peer: string;
    points_of_agreement: string[];
    points_of_disagreement: string[];
  };
  scenario_coverage: {
    scenarios_reviewed: number;
    scenarios_identified: number;
    coverage_ratio: number;
  };
}

export interface ReviewAdversarialArtifact extends AdversarialArtifact {
  file_dispositions: {
    path: string;
    status: 'reviewed' | 'not_applicable';
    issues_found: number;
  }[];
  cross_review: {
    peer_conclusion_summary: string;
    my_independent_check: string;
    alignment_or_conflict: string;
  };
  ci_independence: {
    source: 'github_api' | 'checks_page';
    status: string;
    confirmed_at: string;
  };
  file_coverage: {
    files_reviewed: number;
    files_in_diff: number;
    coverage_ratio: number;
  };
}

export interface StageTransitionSuggestion {
  stage_id: string;
  message_id: number;
  from_speaker: string;
  target_key: string;
  reason: string;
  guard: string | null;
  artifacts: Record<string, string>;
  created_at: string;
  /** 显式信号类型。缺失时引擎按字段推断（向后兼容） */
  signal_type?: SignalType;
  consensus?: boolean;
  positions?: Position[];
  review_round?: number;
  gate_evidence?: Record<string, unknown>;
  adversarial_artifact?: AdversarialArtifact;
}

/** 引擎评估结果的动作 */
export type EvaluationAction = "auto_advanced" | "blocked" | "escalated";

/** 引擎评估结果中的单条原因 */
export interface EvaluationReason {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
}

/** 引擎评估结果 */
export interface EvaluationResult {
  action: EvaluationAction;
  target_key?: string;
  reasons: EvaluationReason[];
}

export interface CollaborationInput {
  createIssue(input: CreateIssueInput): Promise<CreateIssueResult>;
  sendMessage(stageId: string, text: string, fromSpeaker?: string, toSpeakers?: string[]): Promise<void>;
  interruptMessage(messageId: number): Promise<boolean>;
  registerIssueConsumer(issueId: string, consumer: CollaborationConsumer): void;
  unregisterIssueConsumer(issueId: string, consumer: CollaborationConsumer): void;
  registerWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void;
  unregisterWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void;
  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[];
  dismissSuggestion(stageId: string, targetKey: string, createdAt: string): boolean;
  advanceStage(stageId: string, targetKey: string): Promise<Stage>;
  rollbackStage(stageId: string, targetKey: string): Promise<Stage>;
  getStageAuditTrail(stageId: string): StageAuditRecord[];
  closeIssue(issueId: string): Promise<{ issue: Issue; cleanup: CleanupResult }>;
  /** 查询 stage 是否有 agent 正在执行（用于 activity_status 判断） */
  isInvoking(stageId: string): boolean;
  /** 计算 stage 的 activity_status（唯一实现） */
  getActivityStatus(stageId: string, issueClosedAt?: string | null): "ai_running" | "needs_human" | "completed";
  /** 启动恢复：重新路由已完成消息的 to_speakers */
  resumeRoute(stageId: string, message: Message): Promise<void>;
}

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
