import type { SnailDen, SystemAI } from "../snail-den";

// Re-export enriched view types from shared (single source of truth)
export type {
  WorkspaceSummary,
  WorkspaceDetail,
  IssueDetail,
  StageDetail,
  ConversationDetail,
  ConversationMessagesPage,
  ConversationRecentMessagesSnapshot,
  ConversationHistoryWindow,
  ConversationHistorySearchPage,
  BossMentionItem,
  ConversationDispatchState,
} from "../shared/types";

import type { Conversation, MessageWithEvents } from "../shared/types";

export interface WorkspaceManagerDeps {
  systemAI: SystemAI;
  snailDen: SnailDen;
}

export interface SummaryGenerationInput {
  conversation: Conversation;
  previousSummary: string;
  recentMessages: MessageWithEvents[];
}
