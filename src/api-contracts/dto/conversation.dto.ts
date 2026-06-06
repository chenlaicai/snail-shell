import type {
  Conversation,
  ConversationKind,
  ConversationStatus,
  ConversationOwnerType,
  ConversationDetail,
  ConversationMessagesPage,
  ConversationRecentMessagesSnapshot,
  ConversationHistoryWindow,
  ConversationHistorySearchPage,
} from "../../shared";

// Re-export enriched view types from shared (single source of truth)
export type {
  ConversationDetail as ConversationDetailDto,
  ConversationMessagesPage,
  ConversationRecentMessagesSnapshot,
  ConversationHistoryWindow,
  ConversationHistorySearchPage,
};

// Backward-compatible alias
export type ConversationDto = Conversation;

export type { ConversationKind, ConversationStatus, ConversationOwnerType };
