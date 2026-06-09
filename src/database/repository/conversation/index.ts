/**
 * Conversation Repository 模块
 *
 * 提供会话、消息、事件的持久化功能。
 */

export type {
  Message,
  MessageEvent,
  MessageContext,
  Conversation,
  MessageDispatch,
  CreateMessageInput,
  CreateMessageEventInput,
  CreateConversationInput,
  CreateMessageDispatchInput,
  MessageRole,
  MessageStatus,
  ConversationKind,
  ConversationStatus,
  MessageEventKind,
  MessageEventCategory,
  ConversationRepository,
} from "./types";

export { SqliteConversationRepository } from "./sqlite";
