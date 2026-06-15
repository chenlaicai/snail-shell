import type { ChannelType, IMInboundMessage } from "@domain/im/model";
import type { IMPort, IMChannelAdapter, IMTransport, LobbyInboundResult } from "@domain/im/port";
import type { IMRepository } from "./repository";
import type { LobbyRouter } from "./router";

/**
 * IM 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class IMAdapter implements IMPort {
  private channels = new Map<string, IMChannelAdapter>();

  constructor(private repo: IMRepository) {}

  listChannelConfigs() {
    return this.repo.listChannelConfigs();
  }

  getChannelConfig(type: string) {
    return this.repo.getChannelConfig(type);
  }

  /** 注册渠道适配器 */
  registerChannel(adapter: IMChannelAdapter): void {
    this.channels.set(adapter.channelType, adapter);
  }

  /** 获取渠道适配器 */
  getChannel(type: string): IMChannelAdapter | undefined {
    return this.channels.get(type);
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
 * 包含入站去重、白名单过滤、lobby 路由。
 */
export class LobbyAwareChannel implements IMChannelAdapter {
  readonly channelType: ChannelType;

  // 入站去重
  private readonly processedInbound = new Map<string, { processedAt: number }>();
  private readonly pendingInbound = new Set<string>();

  private forwardHandler: ((params: { channelType: ChannelType; chatId: string; tenantKey: string | null; stageId: string; text: string }) => Promise<void>) | null = null;


  constructor(
    private readonly config: {
      channelType: ChannelType;
      allowedChats: string[];
      maxTextLength: number;
      streamingEnabled: boolean;
    },
    private readonly transport: IMTransport,
    private readonly lobbyRouter: LobbyRouter,
  ) {
    this.channelType = config.channelType;
  }

  async start(): Promise<void> {
    await this.transport.prepare();
    this.transport.onMessage((msg) => this.scheduleInbound(msg));
  }

  async stop(): Promise<void> {
    this.processedInbound.clear();
    this.pendingInbound.clear();
    await this.transport.stop();
  }

  /** 注册 stage 普通消息转发处理器，由 app/im-hub 注入 */
  onStageMessage(handler: (params: { channelType: ChannelType; chatId: string; tenantKey: string | null; stageId: string; text: string }) => Promise<void>): void {
    this.forwardHandler = handler;
  }

  /** 由 Hono server 调用，将 webhook 请求体传递给 transport 解析 */
  handleWebhook(body: unknown): void {
    if (this.transport.handleWebhook) {
      this.transport.handleWebhook(body);
    }
  }

  /** 发送文本消息（带截断） */
  async sendText(chatId: string, text: string): Promise<string> {
    const truncated = text.length > this.config.maxTextLength
      ? text.slice(0, this.config.maxTextLength) + "..."
      : text;
    return this.transport.sendText(chatId, truncated);
  }

  async patchText(messageId: string, text: string): Promise<void> {
    if (!this.transport.patchText) {
      return;
    }
    await this.transport.patchText(messageId, text);
  }

  private scheduleInbound(message: IMInboundMessage): void {
    void this.handleInbound(message).catch(console.error);
  }

  private async handleInbound(message: IMInboundMessage): Promise<void> {
    // 白名单检查
    if (!this.config.allowedChats.includes(message.chat_id)) return;

    // 去重
    const clientId = `${this.channelType}:${message.tenant_key ?? "unknown"}:${message.chat_id}:${message.message_id}`;
    this.pruneProcessedInbound(Date.now());
    if (this.processedInbound.has(clientId) || this.pendingInbound.has(clientId)) return;
    this.pendingInbound.add(clientId);

    try {
      const result = await this.lobbyRouter.processInbound({
        channelType: this.channelType,
        channelChatId: message.chat_id,
        channelTenantKey: message.tenant_key ?? null,
        text: message.text,
      });

      this.processedInbound.set(clientId, { processedAt: Date.now() });

      await this.handleRoutedResult(message, result);
    } finally {
      this.pendingInbound.delete(clientId);
    }
  }

  private async handleRoutedResult(
    message: IMInboundMessage,
    result: LobbyInboundResult,
  ): Promise<void> {
    if ("response" in result) {
      if (result.response.text) {
        await this.sendText(message.chat_id, result.response.text);
      }
      return;
    }

    if (!this.forwardHandler) {
      await this.sendText(message.chat_id, "Stage 消息转发服务尚未就绪。");
      return;
    }

    await this.forwardHandler({
      channelType: this.channelType,
      chatId: message.chat_id,
      tenantKey: message.tenant_key ?? null,
      stageId: result.stageId,
      text: result.text,
    });
  }

  private pruneProcessedInbound(now: number): void {
    const TTL = 24 * 60 * 60 * 1000;
    const MAX = 10_000;
    for (const [key, entry] of this.processedInbound) {
      if (now - entry.processedAt > TTL) this.processedInbound.delete(key);
    }
    while (this.processedInbound.size > MAX) {
      const oldest = this.processedInbound.keys().next().value;
      if (!oldest) break;
      this.processedInbound.delete(oldest);
    }
  }
}
