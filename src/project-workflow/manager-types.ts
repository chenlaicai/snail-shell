import type { Conversation, ConversationHistorySearchResult, ConversationStore, Feature, MessageWithEvents, Project, RoleName, Stage } from "../persistence/store";
import type { SnailDen, SystemAI } from "../snail-den";
import type { RoleRegistry } from "../roles";

export interface ProjectManagerDeps {
  roleRegistry: RoleRegistry;
  systemAI: SystemAI;
  snailDen: SnailDen;
}

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
  boss_pending_count: number;
  current_stage: StageDetail | null;
}

export interface StageDetail extends Stage {
  input_artifacts: string[];
  boss_pending_count: number;
  stage_definition: {
    key: string;
    title: string;
    input_description: string | null;
    output_description: string | null;
    acceptance_focus: string[];
  } | null;
  role_definitions: Array<{
    name: string;
    snail_template_id: string | null;
    is_primary: boolean;
    description: string;
    working_rules: string[];
  }>;
}

export interface ConversationDetail extends Conversation {
  message_count: number;
  boss_pending_count: number;
}

export interface ConversationMessagesPage {
  items: MessageWithEvents[];
  next_offset: number;
  has_more: boolean;
}

export interface ConversationRecentMessagesSnapshot {
  items: MessageWithEvents[];
  last_event_id: number;
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
  from_role: RoleName | null;
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
