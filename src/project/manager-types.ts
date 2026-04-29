import type { Conversation, ConversationHistorySearchResult, ConversationStore, Feature, MessageWithEvents, Project, SnailName, Stage } from "../persistence/store";

export interface ProjectSummary extends Project {
  conversation_count: number;
  stage_count: number;
  feature_count: number;
  boss_pending_count: number;
}

export interface ProjectDetail extends ProjectSummary {
  features: FeatureDetail[];
}

export interface FeatureDetail extends Feature {
  stages: StageDetail[];
  conversation_count: number;
  artifact_count: number;
  boss_pending_count: number;
  current_stage: StageDetail | null;
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
  items: MessageWithEvents[];
  next_offset: number;
  has_more: boolean;
}

export interface ConversationHistoryWindow {
  items: MessageWithEvents[];
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
  recentMessages: MessageWithEvents[];
}
