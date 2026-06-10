import type {
  Conversation,
  Message,
  MessageEvent,
  MessageContext,
  MessageDispatch,
  CreateConversationInput,
  CreateMessageInput,
  MessageContextKind,
  MessageDispatchStatus,
  IMChannelConfig,
  IMInboundMessage,
  LobbySession,
} from "./model";

/** IM 端口定义 */
export interface IMPort {
  // ── 会话 ──────────────────────────────────────────────────────────────
  findConversationById(id: string): Conversation | undefined;
  listConversations(filters?: { workspace_id?: string; issue_id?: string; stage_id?: string; limit?: number; offset?: number }): Conversation[];
  createConversation(input: CreateConversationInput): Conversation;

  // ── 消息 ──────────────────────────────────────────────────────────────
  findMessageById(id: number): Message | undefined;
  listMessages(conversationId: string, limit?: number, offset?: number): Message[];
  createMessage(input: CreateMessageInput): Message;

  // ── 消息事件 ──────────────────────────────────────────────────────────
  listMessageEvents(messageId: number): MessageEvent[];
  appendEvent(messageId: number, event: Omit<MessageEvent, "id" | "created_at">): MessageEvent;

  // ── 消息上下文 ────────────────────────────────────────────────────────
  getMessageContext(messageId: number): MessageContext | null;
  setMessageContext(messageId: number, kind: MessageContextKind, context: string): void;

  // ── 消息分发 ──────────────────────────────────────────────────────────
  listPendingDispatches(conversationId: string): MessageDispatch[];
  createDispatch(conversationId: string, messageId: number, toRole: string): MessageDispatch;
  updateDispatchStatus(dispatchId: number, status: MessageDispatchStatus, consumedByMessageId?: number): void;

  // ── IM 渠道 ──────────────────────────────────────────────────────────
  listChannelConfigs(): IMChannelConfig[];
  getChannelConfig(type: string): IMChannelConfig | undefined;
}

/** IM 渠道传输层接口 */
export interface IMTransport {
  /** 准备连接 */
  prepare(): Promise<void>;
  /** 停止连接 */
  stop(): Promise<void>;
  /** 监听入站消息 */
  onMessage(handler: (msg: IMInboundMessage) => void): void;
  /** 发送文本消息，返回 message_id */
  sendText(chatId: string, text: string, uuid?: string): Promise<string>;
  /** 更新文本消息（流式响应） */
  patchText?(messageId: string, text: string): Promise<void>;
}

/** IM 渠道适配器接口 */
export interface IMChannelAdapter {
  readonly channelType: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
