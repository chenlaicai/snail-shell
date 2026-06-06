import type {
  Message,
  MessageEvent,
  MessageEventSource,
  MessageContext,
  MessageDispatch,
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  RoleName,
  MessageRole,
  MessageStatus,
  BossMentionItem,
  ConversationDispatchState,
} from "../../shared";

// Re-export enriched view types from shared (single source of truth)
export type { MessageEvent, MessageEventSource, MessageContext, BossMentionItem, ConversationDispatchState };

// Message entity + API enrichment (content 便捷字段、quoted_message 反规范化)
export type MessageDto = Message & {
  content?: string;
  quoted_message?: { speaker?: string; preview?: string } | null;
};

// GET /api/conversations/:id/events — event + enrichment
export type ConversationEventWithMessage = MessageEvent & {
  message_from_role: RoleName | null;
};

// POST /api/conversations/:id/messages — success response
export type SendMessageResult = {
  messageIds: number[];
};

// POST /api/conversations/:id/messages/:id/approve-tool
export type ApproveToolResult = {
  approved: boolean;
  status: "retrying" | "denied";
};

// POST /api/conversations/:id/messages/:id/interrupt
export type InterruptMessageResult = {
  interrupted: boolean;
};

export type { MessageDispatch, DispatchInboxGroup, DispatchInboxPreviewItem, RoleName, MessageRole, MessageStatus };
