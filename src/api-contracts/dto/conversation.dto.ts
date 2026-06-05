import type {
  Conversation,
  ConversationKind,
  ConversationStatus,
  ConversationOwnerType,
  ConversationHistorySearchResult,
  MessageWithEvents,
} from "../../shared";

// Conversation entity (re-exported for convenience)
export type ConversationDto = Conversation;

// GET /api/conversations/:id — Conversation + enrichment (from buildConversationDetail)
export type ConversationDetailDto = Conversation & {
  message_count: number;
  boss_pending_count: number;
};

// GET /api/conversations/:id/messages/page
export type ConversationMessagesPage = {
  items: MessageWithEvents[];
  next_offset: number;
  has_more: boolean;
};

// GET /api/conversations/:id/messages/recent
export type ConversationRecentMessagesSnapshot = {
  items: MessageWithEvents[];
  last_event_id: number;
};

// GET /api/conversations/:id/messages/window
export type ConversationHistoryWindow = {
  items: MessageWithEvents[];
};

// GET /api/conversations/:id/history/search
export type ConversationHistorySearchPage = {
  items: ConversationHistorySearchResult[];
  next_offset: number;
  has_more: boolean;
};

export type { ConversationKind, ConversationStatus, ConversationOwnerType };
