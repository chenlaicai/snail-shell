import type { Message, MessageContext, MessageEvent } from "@domain/message/model";
import type { CreateIssueInput, Issue, Stage } from "@domain/issue/model";

export interface CreateIssueResult {
  issue: Issue;
  stage: Stage;
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
}

export interface CollaborationInput {
  createIssue(input: CreateIssueInput): Promise<CreateIssueResult>;
  sendMessage(stageId: string, text: string, fromSpeaker?: string, toSpeakers?: string[]): Promise<void>;
  interruptMessage(messageId: number): Promise<boolean>;
  registerIssueConsumer(issueId: string, consumer: CollaborationConsumer): void;
  unregisterIssueConsumer(issueId: string, consumer: CollaborationConsumer): void;
  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[];
  advanceStage(stageId: string, targetKey: string): Promise<Stage>;
  closeIssue(issueId: string): Issue;
  /** 查询 stage 是否有 agent 正在执行（用于 activity_status 判断） */
  isInvoking(stageId: string): boolean;
  /** 启动恢复：重新路由已完成消息的 to_speakers */
  resumeRoute(stageId: string, message: Message): Promise<void>;
}

export interface CollaborationConsumer {
  onMessageStarted?(stageId: string, message: Message): void | Promise<void>;
  onEvent(stageId: string, event: MessageEvent): void | Promise<void>;
  onMessageCompleted(stageId: string, message: Message, context: MessageContext | null): void | Promise<void>;
  onUserCalled(stageId: string, message: Message): void | Promise<void>;
  onStageTransitionSuggested?(stageId: string, suggestion: StageTransitionSuggestion): void | Promise<void>;
}
