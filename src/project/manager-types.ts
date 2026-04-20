import type { Conversation, ConversationHistorySearchResult, ConversationStore, MessageWithParts, Project, SnailName, Stage } from "../persistence/store";

export interface ProjectSummary extends Project {
  conversation_count: number;
  stage_count: number;
  boss_pending_count: number;
}

export interface ProjectDetail extends ProjectSummary {
  stages: Stage[];
}

export interface StageDetail extends Stage {
  boss_pending_count: number;
}

export interface ConversationDetail extends Conversation {
  message_count: number;
  artifact_count: number;
  boss_pending_count: number;
}

export interface ConversationMessagesPage {
  items: MessageWithParts[];
  next_offset: number;
  has_more: boolean;
}

export interface ConversationHistoryWindow {
  items: MessageWithParts[];
}

export interface ConversationHistorySearchPage {
  items: ConversationHistorySearchResult[];
  next_offset: number;
  has_more: boolean;
}

export interface BossMentionItem {
  dispatch_id: number;
  message_id: number;
  from_snail: SnailName | null;
  created_at: string;
  preview: string;
}

export interface ConversationDispatchState {
  dispatches: ReturnType<ConversationStore["listDispatches"]>;
  inbox_groups: ReturnType<ConversationStore["listDispatchInboxGroups"]>;
}

export interface SummaryGenerationInput {
  conversation: Conversation;
  previousSummary: string;
  recentMessages: MessageWithParts[];
}
