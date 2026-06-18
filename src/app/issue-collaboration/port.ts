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
  registerIssueConsumer(issueId: string, consumer: CollaborationConsumer): void;
  unregisterIssueConsumer(issueId: string, consumer: CollaborationConsumer): void;
  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[];
  advanceStage(stageId: string, targetKey: string): Promise<Stage>;
}

export interface CollaborationConsumer {
  onMessageStarted?(stageId: string, message: Message): void | Promise<void>;
  onEvent(stageId: string, event: MessageEvent): void | Promise<void>;
  onMessageCompleted(stageId: string, message: Message, context: MessageContext | null): void | Promise<void>;
  onUserCalled(stageId: string, message: Message): void | Promise<void>;
  onStageTransitionSuggested?(stageId: string, suggestion: StageTransitionSuggestion): void | Promise<void>;
}
