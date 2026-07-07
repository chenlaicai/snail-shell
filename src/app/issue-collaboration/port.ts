import type { Message, MessageContext, MessageEvent } from "@domain/message/model";
import type { CreateIssueInput, Issue, Stage } from "@domain/issue/model";
import type { StageAuditRecord } from "@domain/issue/port";
import type { CleanupResult } from "@app/issue-collaboration/resource-cleanup";
import type { StageSuggestionRecord } from "@domain/issue/_internal/repository";

export interface CreateIssueResult {
  issue: Issue;
  stage: Stage;
}

/** 信号类型：显式声明信号语义，引擎按类型路由 */
export type SignalType = "gate_complete" | "adversarial_consensus" | "disagreement";

export interface StageTransitionSuggestion {
  stage_id: string;
  message_id: number;
  from_speaker: string;
  target_key: string;
  reason: string;
  guard: string | null;
  artifacts: Record<string, string>;
  created_at: string;
  /** 显式信号类型。缺失时引擎按 stage config 的 accepted_signal_types 推断 */
  signal_type?: SignalType;
  review_round?: number;
  /** 建议被忽略的次数（用于 B5：重复建议提示） */
  dismiss_count?: number;
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
  /** 将 suggestion 标记为 seen（已阅），从内存移除但 DB 保留 */
  acknowledgeSuggestion(stageId: string, targetKey: string, createdAt: string): boolean;
  advanceStage(stageId: string, targetKey: string, userHint?: string): Promise<Stage>;
  /** 用户强制推进：跳过引擎评估，直接执行推进并记录审计日志 */
  forceAdvance(stageId: string, targetKey: string, userHint?: string): Promise<{ stage: Stage; evaluation: EvaluationResult }>;
  /** L2: 手动推进前的引擎评估（不执行自动推进） */
  evaluateAdvance(stageId: string): Promise<EvaluationResult>;
  rollbackStage(stageId: string, targetKey: string, userHint?: string): Promise<Stage>;
  getStageAuditTrail(stageId: string): StageAuditRecord[];
  closeIssue(issueId: string): Promise<{ issue: Issue; cleanup: CleanupResult }>;
  /** 查询 stage 是否有 agent 正在执行（用于 activity_status 判断） */
  isInvoking(stageId: string): boolean;
  /** 计算 stage 的 activity_status（唯一实现） */
  getActivityStatus(stageId: string, issueClosedAt?: string | null): "snail_running" | "needs_human" | "completed";
  /** 启动恢复：重新路由已完成消息的 to_speakers */
  resumeRoute(stageId: string, message: Message): Promise<void>;
  /** 启动恢复：从 DB 恢复未处理的 suggestions 到内存缓存 */
  restoreSuggestions(stageId: string, records: StageSuggestionRecord[]): void;
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
  onActivityStatusChanged(issueId: string, activityStatus: "snail_running" | "needs_human" | "completed", previousStatus: "snail_running" | "needs_human" | "completed"): void;
}
