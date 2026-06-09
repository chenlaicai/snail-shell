/**
 * Conversation 模块公开类型
 *
 * 定义会话、消息、事件的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Repository 接口访问数据
 */

/**
 * 消息角色
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * 消息状态
 */
export type MessageStatus =
  | "streaming"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "pending_approval";

/**
 * 会话类型
 */
export type ConversationKind =
  | "discussion"
  | "planning"
  | "design"
  | "implementation"
  | "review"
  | "bugfix";

/**
 * 会话状态
 */
export type ConversationStatus = "active" | "paused" | "completed" | "archived";

/**
 * 消息事件类型
 */
export type MessageEventKind =
  | "start"
  | "text"
  | "content_block"
  | "tool_call"
  | "tool_result"
  | "command"
  | "command_result"
  | "signal"
  | "error";

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
  /** 消息内容（从 MessageEvent 中提取的文本内容） */
  content?: string;
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
 * 消息派发状态
 */
export type MessageDispatchStatus = "pending" | "seen" | "consumed" | "skipped";

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
  status: MessageDispatchStatus;
  /** 消费消息 ID */
  consumed_by_message_id: number | null;
  /** 创建时间 */
  created_at: string;
  /** 消费时间 */
  consumed_at: string | null;
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
  content?: string;
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
 * 创建消息派发输入
 */
export interface CreateMessageDispatchInput {
  conversation_id: string;
  message_id: number;
  to_role: string;
  status?: string;
}
