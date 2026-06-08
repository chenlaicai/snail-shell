import type { AgentRuntime, EventSource } from '@/snail/acs/types.js';

/** 对话类型（对话的业务语义） */
export type ConversationKind =
  | 'discussion'
  | 'planning'
  | 'design'
  | 'implementation'
  | 'review'
  | 'bugfix';

/** 对话状态 */
export type ConversationStatus = 'active' | 'paused' | 'completed' | 'archived';

/** 对话（Stage 内的协作容器，一个 Stage 绑定一个 Conversation） */
export interface Conversation {
  /** 对话 ID */
  id: string;
  /** 所属工作区 ID */
  workspace_id: string;
  /** 所属 Issue ID */
  issue_id: string;
  /** 绑定的 Stage ID */
  stage_id: string;
  /** 对话标题 */
  title?: string;
  /** 对话类型 */
  kind: ConversationKind;
  /** 对话状态 */
  status: ConversationStatus;
  /** 默认角色（对话创建时的初始角色） */
  default_role: string;
  /** 参与角色列表 */
  participating_roles: string[];
  /** 对话摘要 */
  summary?: string;
  /** 对话交接链（来源对话 ID 列表） */
  from_conversation_ids: string[];
  /** 创建时间 */
  created_at: string;
  /** 最后更新时间 */
  updated_at: string;
}

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** 消息状态 */
export type MessageStatus =
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'pending_approval';

/** 消息（对话中的单条消息） */
export interface Message {
  /** 消息 ID（自增整数） */
  id: number;
  /** 所属对话 ID */
  conversation_id: string;
  /** 客户端去重 ID（乐观写入防重） */
  client_id?: string;
  /** 发送角色 */
  from_role: string;
  /** 目标角色列表 */
  to_roles: string[];
  /** 消息角色 */
  role: MessageRole;
  /** 产生该消息的运行时 */
  runtime: AgentRuntime;
  /** 消息状态 */
  status: MessageStatus;
  /** 引用的消息 ID（回复某条消息时使用） */
  quoted_message_id?: number;
  /** 上下文截断点（消息 ID，标记上下文窗口边界） */
  context_cutoff_at?: number;
  /** 创建时间 */
  created_at: string;
  /** 最后更新时间 */
  updated_at: string;
}

// ─── MessageEvent（事件流） ───

/** 消息事件（消息内容的原子单元，消息无 body 字段，内容全部在事件流中） */
export interface MessageEvent {
  /** 事件 ID（自增整数） */
  id: number;
  /** 所属消息 ID */
  message_id: number;
  /** 事件序号（消息内的排序） */
  seq: number;
  /** 事件分类 */
  category: MessageEventCategory;
  /** 事件类型 */
  kind: MessageEventKind;
  /** 事件负载（结构由 kind 决定） */
  payload: unknown;
  /** 事件来源（运行时溯源） */
  source?: EventSource;
  /** 创建时间 */
  created_at: string;
}

/** 消息事件分类 */
export type MessageEventCategory = 'content' | 'signal';

/** 消息事件类型 */
export type MessageEventKind =
  | 'start'
  | 'text'
  | 'content_block'
  | 'tool_call'
  | 'tool_result'
  | 'command'
  | 'command_result'
  | 'signal'
  | 'error';

// ─── 事件 payload 类型 ───

/** start 事件负载（消息流开始） */
export interface StartEventPayload {
  /** 运行时类型 */
  runtime: AgentRuntime;
  /** 运行时会话 ID */
  session_id?: string;
}

/** text 事件负载（文本片段） */
export interface TextEventPayload {
  /** 文本内容 */
  text: string;
}

/** content_block 事件负载（结构化内容块） */
export interface ContentBlockEventPayload {
  /** 内容块类型 */
  block_type: string;
  /** 内容块数据 */
  content: unknown;
}

/** tool_call 事件负载（工具调用请求） */
export interface ToolCallEventPayload {
  /** 工具名称 */
  tool_name: string;
  /** 工具调用 ID */
  tool_call_id: string;
  /** 调用参数 */
  arguments?: unknown;
}

/** tool_result 事件负载（工具调用结果） */
export interface ToolResultEventPayload {
  /** 对应的工具调用 ID */
  tool_call_id: string;
  /** 调用结果 */
  result: unknown;
  /** 是否为错误结果 */
  is_error?: boolean;
}

/** command 事件负载（命令执行） */
export interface CommandEventPayload {
  /** 执行的命令 */
  command: string;
}

/** command_result 事件负载（命令执行结果） */
export interface CommandResultEventPayload {
  /** 退出码 */
  exit_code: number;
  /** 标准输出 */
  stdout?: string;
  /** 标准错误 */
  stderr?: string;
}

/** signal 事件负载（运行时信号） */
export interface SignalEventPayload {
  /** 信号类型 */
  signal: string;
  /** 信号附加数据 */
  data?: unknown;
}

/** error 事件负载（运行时错误） */
export interface ErrorEventPayload {
  /** 错误信息 */
  message: string;
  /** 错误码 */
  code?: string;
}

// ─── MessageContext（最终上下文） ───

/** 消息上下文类型（决定 context 字段的生成方式） */
export type MessageContextKind =
  | 'final_text'
  | 'message_out'
  | 'event_summary'
  | 'llm_summary'
  | 'mcp_final_body';

/** 消息最终上下文（流式完成后生成的可注入 prompt 文本） */
export interface MessageContext {
  /** 对应的消息 ID（1:1 关系） */
  message_id: number;
  /** 上下文类型 */
  kind: MessageContextKind;
  /** 可注入 prompt 的上下文文本 */
  context: string;
  /** 最后更新时间 */
  updated_at: string;
}

// ─── MessageDispatch（投递收件箱） ───

/** 投递状态 */
export type DispatchStatus = 'pending' | 'seen' | 'consumed' | 'skipped';

/** 消息投递记录（消息发送时为每个目标角色创建一条投递记录） */
export interface MessageDispatch {
  /** 投递记录 ID */
  id: number;
  /** 所属对话 ID */
  conversation_id: string;
  /** 对应的消息 ID */
  message_id: number;
  /** 目标角色 */
  to_role: string;
  /** 投递状态 */
  status: DispatchStatus;
  /** 消费该投递的回复消息 ID（角色回复时关联） */
  consumed_by_message_id?: number;
  /** 创建时间 */
  created_at: string;
  /** 消费时间（未消费时为 undefined） */
  consumed_at?: string;
}
