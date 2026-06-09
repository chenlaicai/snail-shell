/**
 * Conversation Repository 接口
 *
 * 定义会话、消息、事件的持久化操作接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口访问数据库
 */

import type {
  Message,
  MessageEvent,
  MessageContext,
  Conversation,
  MessageDispatch,
  CreateMessageInput,
  CreateMessageEventInput,
  CreateConversationInput,
  CreateMessageDispatchInput,
  MessageStatus,
} from "../types";

/**
 * Conversation Repository 接口
 *
 * 定义会话、消息、事件的持久化操作。
 */
export interface ConversationRepository {
  // ═══ Message CRUD ═══

  /**
   * 获取消息
   * @param id 消息 ID
   * @returns 消息实体，不存在返回 null
   */
  getMessage(id: number): Promise<Message | null>;

  /**
   * 获取会话的消息列表
   * @param conversationId 会话 ID
   * @param limit 限制数量
   * @returns 消息列表
   */
  getMessages(conversationId: string, limit?: number): Promise<Message[]>;

  /**
   * 保存消息
   * @param message 消息实体
   */
  saveMessage(message: CreateMessageInput): Promise<Message>;

  /**
   * 更新消息状态
   * @param id 消息 ID
   * @param status 新状态
   */
  updateMessageStatus(id: number, status: MessageStatus): Promise<void>;

  // ═══ MessageEvent CRUD ═══

  /**
   * 获取消息事件列表
   * @param messageId 消息 ID
   * @returns 事件列表
   */
  getMessageEvents(messageId: number): Promise<MessageEvent[]>;

  /**
   * 保存消息事件
   * @param event 事件实体
   */
  saveMessageEvent(event: CreateMessageEventInput): Promise<MessageEvent>;

  // ═══ MessageContext CRUD ═══

  /**
   * 获取消息上下文
   * @param messageId 消息 ID
   * @returns 上下文实体，不存在返回 null
   */
  getMessageContext(messageId: number): Promise<MessageContext | null>;

  /**
   * 保存消息上下文
   * @param context 上下文实体
   */
  saveMessageContext(context: Omit<MessageContext, "updated_at">): Promise<void>;

  // ═══ Conversation CRUD ═══

  /**
   * 获取会话
   * @param id 会话 ID
   * @returns 会话实体，不存在返回 null
   */
  getConversation(id: string): Promise<Conversation | null>;

  /**
   * 获取 Stage 的会话
   * @param stageId Stage ID
   * @returns 会话实体，不存在返回 null
   */
  getStageConversation(stageId: string): Promise<Conversation | null>;

  /**
   * 保存会话
   * @param conversation 会话实体
   */
  saveConversation(conversation: CreateConversationInput): Promise<Conversation>;

  // ═══ MessageDispatch CRUD ═══

  /**
   * 获取会话的待处理派发
   * @param conversationId 会话 ID
   * @param toRole 目标角色
   * @returns 派发列表
   */
  getPendingDispatches(conversationId: string, toRole: string): Promise<MessageDispatch[]>;

  /**
   * 保存消息派发
   * @param dispatch 派发实体
   */
  saveMessageDispatch(dispatch: CreateMessageDispatchInput): Promise<MessageDispatch>;

  /**
   * 标记派发为已消费
   * @param ids 派发 ID 列表
   * @param consumedByMessageId 消费消息 ID
   */
  markDispatchesConsumed(ids: number[], consumedByMessageId: number): Promise<void>;

  // ═══ 查询方法 ═══

  /**
   * 获取会话最近消息
   * @param conversationId 会话 ID
   * @param limit 限制数量
   * @returns 消息列表
   */
  getRecentMessages(conversationId: string, limit: number): Promise<Message[]>;

  /**
   * 搜索消息
   * @param query 搜索关键词
   * @returns 消息列表
   */
  searchMessages(query: string): Promise<Message[]>;
}
