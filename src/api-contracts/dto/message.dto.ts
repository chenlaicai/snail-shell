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
} from "../../shared";

// Message entity + API enrichment (content 便捷字段、quoted_message 反规范化)
export type MessageDto = Message & {
  content?: string;
  quoted_message?: { speaker?: string; preview?: string } | null;
};

// MessageWithEvents = Message + events + context (from domain-types.ts)
export type { MessageEvent, MessageEventSource, MessageContext };

// GET /api/conversations/:id/events — event + enrichment
export type ConversationEventWithMessage = MessageEvent & {
  message_from_role: RoleName | null;
};

// GET /api/conversations/:id/dispatch-state
export type ConversationDispatchState = {
  dispatches: MessageDispatch[];
  inbox_groups: Array<DispatchInboxGroup & { messages: DispatchInboxPreviewItem[] }>;
};

// BossMentionItem (from manager-types.ts)
export type BossMentionItem = {
  dispatch_id: number;
  message_id: number;
  from_role: RoleName | null;
  created_at: string;
  preview: string;
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
