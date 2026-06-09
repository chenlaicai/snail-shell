/**
 * Conversation Repository 模块
 *
 * 提供会话、消息、事件的持久化功能。
 *
 * 设计原则：
 * - 类型从 conversation 原子模块导入
 * - 实现 ConversationRepository 接口
 */

// 从原子模块导入类型
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
} from "../../../conversation";

// 导出实现
export { SqliteConversationRepository } from "./sqlite";
