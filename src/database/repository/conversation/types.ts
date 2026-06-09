/**
 * Conversation Repository 类型定义
 *
 * 定义会话、消息、事件的持久化接口。
 */

/**
 * 消息角色
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * 消息状态
 */
export type MessageStatus = "streaming" | "completed" | "failed" | "interrupted" | "cancelled" | "pending_approval";

/**
 * 会话类型
 */
export type ConversationKind = "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";

/**
 * 会话状态
 */
export type ConversationStatus = "active" | "paused" | "completed" | "archived";

/**
 * 消息事件类型
 */
export type MessageEventKind = "start" | "text" | "content_block" | "tool_call" | "tool_result" | "command" | "command_result" | "signal" | "error";

/**
 * 消息事件类别
 */
export type MessageEventCategory = "content" | "signal";

/**
 * 消息实体
 */
export interface Message {
  /** 消息 ID */
  id: number;
  /** 所属会话 ID */
  conversation_id: string;
  /** 客户端 ID */
  client_id: string | null;
  /** 发送角色 */
  from_role: string | null;
  /** 目标角色列表 */
  to_roles: string[];
  /** 消息角色 */
  role: MessageRole;
  /** 引用的消息 ID */
  quoted_message_id: number | null;
  /** 上下文截止时间 */
  context_cutoff_at: string;
  /** 运行时类型 */
  runtime: string | null;
  /** 消息状态 */
  status: MessageStatus;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/**
 * 消息事件实体
 */
export interface MessageEvent {
  /** 事件 ID */
  id: number;
  /** 所属消息 ID */
  message_id: number;
  /** 序列号 */
  seq: number;
  /** 事件类别 */
  category: MessageEventCategory;
  /** 事件类型 */
  kind: MessageEventKind;
  /** 事件负载 */
  payload: Record<string, unknown>;
  /** 事件来源 */
  source: string;
  /** 创建时间 */
  created_at: string;
}

/**
 * 消息上下文实体
 */
export interface MessageContext {
  /** 所属消息 ID */
  message_id: number;
  /** 上下文类型 */
  kind: string;
  /** 上下文内容 */
  context: string;
  /** 更新时间 */
  updated_at: string;
}

/**
 * 会话实体
 */
export interface Conversation {
  /** 会话 ID */
  id: string;
  /** 所属工作区 ID */
  workspace_id: string | null;
  /** 所属 Issue ID */
  issue_id: string | null;
  /** 所属 Stage ID */
  stage_id: string | null;
  /** 所有者类型 */
  owner_type: string;
  /** 所有者 ID */
  owner_id: string | null;
  /** 会话标题 */
  title: string;
  /** 会话类型 */
  kind: ConversationKind;
  /** 会话状态 */
  status: ConversationStatus;
  /** 默认角色 */
  default_role: string;
  /** 参与角色列表 */
  participating_roles: string[];
  /** 会话摘要 */
  summary: string | null;
  /** 来源会话 ID 列表 */
  from_conversation_ids: string[];
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/**
 * 创建消息输入
 */
export interface CreateMessageInput {
  conversation_id: string;
  client_id?: string;
  from_role?: string;
  to_roles?: string[];
  role: MessageRole;
  quoted_message_id?: number;
  runtime?: string;
  status: MessageStatus;
}

/**
 * 创建消息事件输入
 */
export interface CreateMessageEventInput {
  message_id: number;
  seq: number;
  category: MessageEventCategory;
  kind: MessageEventKind;
  payload: Record<string, unknown>;
  source: string;
}

/**
 * 创建会话输入
 */
export interface CreateConversationInput {
  id: string;
  workspace_id?: string;
  issue_id?: string;
  stage_id?: string;
  owner_type?: string;
  owner_id?: string;
  title: string;
  kind: ConversationKind;
  status?: ConversationStatus;
  default_role: string;
  participating_roles?: string[];
  summary?: string;
  from_conversation_ids?: string[];
}

/**
 * 消息派发实体
 */
export interface MessageDispatch {
  /** 派发 ID */
  id: number;
  /** 所属会话 ID */
  conversation_id: string;
  /** 所属消息 ID */
  message_id: number;
  /** 目标角色 */
  to_role: string;
  /** 派发状态 */
  status: string;
  /** 消费消息 ID */
  consumed_by_message_id: number | null;
  /** 创建时间 */
  created_at: string;
  /** 消费时间 */
  consumed_at: string | null;
}

/**
 * 创建消息派发输入
 */
export interface CreateMessageDispatchInput {
  conversation_id: string;
  message_id: number;
  to_role: string;
  status?: string;
}

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
