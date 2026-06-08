/**
 * Conversation Service — 对话消息流的跨模块编排。
 *
 * 编排模块：conversation, issue, snail
 */

import type { Message, MessageEvent, MessageDispatch } from '@/conversation/types.js';
import type { AgentCapabilitySpec } from '@/snail/acs/types.js';

/** 发送消息的输入参数 */
export interface SendMessageInput {
  conversation_id: string;
  from_role: string;
  content: string;
}

/** 发送消息的结果 */
export interface SendMessageResult {
  message: Message;
  dispatches: MessageDispatch[];
}

/** 处理 Agent 调用的输入参数 */
export interface ProcessAgentInvocationInput {
  conversation_id: string;
  role_key: string;
}

/** 处理 Agent 调用的结果 */
export interface ProcessAgentInvocationResult {
  message: Message;
  events: MessageEvent[];
  context_updated: boolean;
}

/**
 * Conversation Service 接口。
 *
 * 跨模块编排：读 Conversation → 读 Stage → 构建 ACS → 调用 Agent → 写 MessageEvent → 更新 Dispatch
 */
export interface ConversationService {
  /** 发送用户消息（创建 Message + Dispatch） */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;

  /** 处理 Agent 调用（构建 ACS → 调运行时 → 写事件流 → 生成 Context） */
  processAgentInvocation(input: ProcessAgentInvocationInput): Promise<ProcessAgentInvocationResult>;

  /** 获取对话的消息历史 */
  getMessageHistory(conversationId: string, options?: { limit?: number; before?: number }): Promise<Message[]>;

  /** 获取角色的待处理投递 */
  getPendingDispatches(conversationId: string, role: string): Promise<MessageDispatch[]>;
}
