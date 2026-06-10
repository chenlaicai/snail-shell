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
} from "@domain/im/model";
import type { IMPort, IMTransport, IMChannelAdapter } from "@domain/im/port";
import { InMemoryIMRepository, type IMRepository } from "./repository";

/**
 * IM 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class IMAdapter implements IMPort {
  private channels = new Map<string, IMChannelAdapter>();

  constructor(private repo: IMRepository) {}

  // ── 会话 ──────────────────────────────────────────────────────────────

  findConversationById(id: string): Conversation | undefined {
    return this.repo.findConversationById(id);
  }

  listConversations(filters?: { workspace_id?: string; issue_id?: string; stage_id?: string; limit?: number; offset?: number }): Conversation[] {
    return this.repo.listConversations(filters);
  }

  createConversation(input: CreateConversationInput): Conversation {
    return this.repo.createConversation(input);
  }

  // ── 消息 ──────────────────────────────────────────────────────────────

  findMessageById(id: number): Message | undefined {
    return this.repo.findMessageById(id);
  }

  listMessages(conversationId: string, limit?: number, offset?: number): Message[] {
    return this.repo.listMessages(conversationId, limit, offset);
  }

  createMessage(input: CreateMessageInput): Message {
    return this.repo.createMessage(input);
  }

  // ── 消息事件 ──────────────────────────────────────────────────────────

  listMessageEvents(messageId: number): MessageEvent[] {
    return this.repo.listMessageEvents(messageId);
  }

  appendEvent(messageId: number, event: Omit<MessageEvent, "id" | "created_at">): MessageEvent {
    return this.repo.appendEvent(messageId, event);
  }

  // ── 消息上下文 ────────────────────────────────────────────────────────

  getMessageContext(messageId: number): MessageContext | null {
    return this.repo.getMessageContext(messageId);
  }

  setMessageContext(messageId: number, kind: MessageContextKind, context: string): void {
    this.repo.setMessageContext(messageId, kind, context);
  }

  // ── 消息分发 ──────────────────────────────────────────────────────────

  listPendingDispatches(conversationId: string): MessageDispatch[] {
    return this.repo.listPendingDispatches(conversationId);
  }

  createDispatch(conversationId: string, messageId: number, toRole: string): MessageDispatch {
    return this.repo.createDispatch(conversationId, messageId, toRole);
  }

  updateDispatchStatus(dispatchId: number, status: MessageDispatchStatus, consumedByMessageId?: number): void {
    this.repo.updateDispatchStatus(dispatchId, status, consumedByMessageId);
  }

  // ── IM 渠道 ──────────────────────────────────────────────────────────

  listChannelConfigs(): IMChannelConfig[] {
    return this.repo.listChannelConfigs();
  }

  getChannelConfig(type: string): IMChannelConfig | undefined {
    return this.repo.getChannelConfig(type);
  }

  /** 注册渠道适配器 */
  registerChannel(adapter: IMChannelAdapter): void {
    this.channels.set(adapter.channelType, adapter);
  }

  /** 启动所有渠道 */
  async startChannels(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.start();
    }
  }

  /** 停止所有渠道 */
  async stopChannels(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
  }
}

/**
 * LobbyAwareChannel 实现。
 * 飞书和企微共享的渠道适配器，通过注入不同的 IMTransport 适配不同平台。
 */
export class LobbyAwareChannel implements IMChannelAdapter {
  private messageHandler: ((msg: IMInboundMessage) => void) | null = null;

  constructor(
    readonly channelType: string,
    private transport: IMTransport,
    private allowedChats: string[],
    private maxTextLength: number,
    private streamingEnabled: boolean,
  ) {}

  async start(): Promise<void> {
    await this.transport.prepare();
    this.transport.onMessage((msg) => this.handleInbound(msg));
  }

  async stop(): Promise<void> {
    await this.transport.stop();
  }

  private async handleInbound(msg: IMInboundMessage): Promise<void> {
    // 白名单校验
    if (!this.allowedChats.includes(msg.chat_id)) {
      return;
    }

    // 转发给消息处理器
    if (this.messageHandler) {
      this.messageHandler(msg);
    }
  }

  /** 设置消息处理器 */
  onMessage(handler: (msg: IMInboundMessage) => void): void {
    this.messageHandler = handler;
  }

  /** 发送消息 */
  async sendMessage(chatId: string, text: string): Promise<string> {
    // 截断超长文本
    const truncatedText = text.length > this.maxTextLength
      ? text.slice(0, this.maxTextLength) + "..."
      : text;

    return this.transport.sendText(chatId, truncatedText);
  }

  /** 更新消息（流式响应） */
  async updateMessage(messageId: string, text: string): Promise<void> {
    if (this.streamingEnabled && this.transport.patchText) {
      const truncatedText = text.length > this.maxTextLength
        ? text.slice(0, this.maxTextLength) + "..."
        : text;

      await this.transport.patchText(messageId, truncatedText);
    }
  }
}

/** 初始化 IM 模块 */
export function init() {
  const repo = new InMemoryIMRepository();
  const adapter = new IMAdapter(repo);
  return { repo, adapter };
}
