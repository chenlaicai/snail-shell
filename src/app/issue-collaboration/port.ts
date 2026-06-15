import type { Message, MessageContext, MessageEvent } from "@domain/message/model";
import type { Stage } from "@domain/issue/model";

export interface LaunchIssueInput {
  issue_id: string;
  stage_key?: string;
  snail_assignments: Record<string, string>;
  initial_message?: string;
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
  launchIssue(input: LaunchIssueInput): Promise<Stage>;
  sendMessage(stageId: string, text: string, fromSpeaker?: string): Promise<void>;
  registerConsumer(stageId: string, consumer: CollaborationConsumer): void;
  unregisterConsumer(stageId: string, consumer: CollaborationConsumer): void;
  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[];
  advanceStage(stageId: string, targetKey: string, snailAssignments: Record<string, string>): Promise<Stage>;
}

export interface CollaborationConsumer {
  onMessageStarted?(stageId: string, message: Message): void | Promise<void>;
  onEvent(stageId: string, event: MessageEvent): void | Promise<void>;
  onMessageCompleted(stageId: string, message: Message, context: MessageContext | null): void | Promise<void>;
  onUserCalled(stageId: string, message: Message): void | Promise<void>;
  onStageTransitionSuggested?(stageId: string, suggestion: StageTransitionSuggestion): void | Promise<void>;
}
