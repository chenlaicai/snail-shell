import type { Message, MessageContext, MessageEvent } from "@domain/message/model";
import type { CreateIssueInput, Issue, Stage } from "@domain/issue/model";
import type { StageAuditRecord } from "@domain/issue/port";
import type { CleanupResult } from "@app/issue-collaboration/resource-cleanup";

export interface CreateIssueResult {
  issue: Issue;
  stage: Stage;
}

export interface Position {
  speaker: string;
  stance: "for" | "against" | "neutral";
  argument: string;
  evidence?: string;
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
  consensus?: boolean;
  positions?: Position[];
  review_round?: number;
  gate_evidence?: Record<string, unknown>;
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
  onAutoAdvanced?(stageId: string, data: { from: string; to: string; reason: string }): void | Promise<void>;
  onContextMissing?(stageId: string, data: { missing_fields: string[] }): void | Promise<void>;
}

export interface WorkspaceConsumer {
  onActivityStatusChanged(issueId: string, activityStatus: "ai_running" | "needs_human" | "completed", previousStatus: "ai_running" | "needs_human" | "completed"): void;
}
