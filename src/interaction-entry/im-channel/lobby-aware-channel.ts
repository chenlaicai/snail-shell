import { logger } from "../../logger";
import type { LobbyRouter } from "../../lobby/router";
import type { LobbyResponseRenderer } from "../../lobby/response-renderer";
import type { LobbySession } from "../../lobby/types";
import type { ConversationGateway, ConversationOutboundEvent } from "../gateway";
import type { FeishuInboundMessage, FeishuTransport } from "../feishu/channel";
import type { IMChannelAdapter } from "./interface";

export interface LobbyAwareChannelConfig {
  channelType: string;
  maxTextLength: number;
  includeUserMessages: boolean;
}

/**
 * 大厅感知的 IM 通道。
 * 替代 FeishuConversationChannel，消息先经过 LobbyRouter 决定去向：
 * - 大厅命令 → 本地处理并返回响应
 * - 房间内消息 → 转发到 ConversationGateway
 */
export interface LobbyAwareChannelDeps {
  transport: FeishuTransport;
  lobbyRouter: LobbyRouter;
  gateway: ConversationGateway;
  responseRenderer: LobbyResponseRenderer;
}

export class LobbyAwareChannel implements IMChannelAdapter {
  readonly channelType: string;
  private readonly unsubscriptions: Array<() => void> = [];
  /** conversationId → chatId 映射，用于出站事件路由 */
  private readonly conversationToChatId = new Map<string, string>();

  constructor(
    private readonly config: LobbyAwareChannelConfig,
    private readonly deps: LobbyAwareChannelDeps,
  ) {
    this.channelType = config.channelType;
  }

  async start(): Promise<void> {
    await this.deps.transport.start({
      onMessage: (message) => this.scheduleInbound(message),
    });
    logger.info("Lobby-aware IM channel started", { channelType: this.channelType });
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscriptions.splice(0)) unsub();
    this.conversationToChatId.clear();
    await this.deps.transport.stop?.();
  }

  private scheduleInbound(message: FeishuInboundMessage): void {
    void this.handleInbound(message).catch((error: unknown) => {
      logger.error("Lobby inbound message processing failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }

  private async handleInbound(message: FeishuInboundMessage): Promise<void> {
    const result = await this.deps.lobbyRouter.processInbound({
      channelType: this.config.channelType,
      channelChatId: message.chatId,
      channelTenantKey: message.tenantKey,
      text: message.text,
    });

    if ("forwarded" in result) {
      // 消息已转发到 conversation，确保已订阅出站事件
      this.ensureSubscribed(result.session);
      return;
    }

    // 发送大厅响应
    const responseText = result.response.text;
    if (responseText) {
      await this.deps.transport.sendText({ chatId: message.chatId, text: responseText });
    }

    // 如果刚进入房间，开始订阅出站事件
    if (result.session.current_conversation_id) {
      this.ensureSubscribed(result.session);
    }
  }

  /**
   * 确保已订阅指定 conversation 的出站事件。
   * 进入房间时调用，将 conversation 的 agent 事件转发到 IM 群。
   */
  private ensureSubscribed(session: LobbySession): void {
    const conversationId = session.current_conversation_id;
    if (!conversationId) return;
    if (this.conversationToChatId.has(conversationId)) return;

    const chatId = session.channel_chat_id;
    this.conversationToChatId.set(conversationId, chatId);

    const unsub = this.deps.gateway.subscribe(conversationId, (event) => {
      this.scheduleOutbound(chatId, event);
    });
    this.unsubscriptions.push(unsub);
  }

  private scheduleOutbound(chatId: string, event: ConversationOutboundEvent): void {
    void this.handleOutbound(chatId, event).catch((error: unknown) => {
      logger.error("Lobby outbound message push failed", {
        chatId,
        messageId: event.type === "message_event_appended" ? event.message_id : null,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async handleOutbound(chatId: string, event: ConversationOutboundEvent): Promise<void> {
    if (event.type !== "message_event_appended") return;
    if (!this.config.includeUserMessages && event.role_name === "Boss Role") return;
    if (event.event.kind !== "text" && event.event.kind !== "content_block") return;

    const rawText = extractEventText(event);
    if (!rawText) return;

    const text = this.deps.responseRenderer.renderOutboundMessage({
      roleName: event.role_name,
      text: rawText,
      maxLength: this.config.maxTextLength,
    });

    const uuid = `snail-${event.message_id}-${event.event.id}`.slice(0, 50);
    await this.deps.transport.sendText({ chatId, text, uuid });
  }
}

function extractEventText(event: ConversationOutboundEvent): string | null {
  if (event.type !== "message_event_appended") return null;
  const payload = event.event.payload as unknown as Record<string, unknown> | undefined;
  if (!payload) return null;
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.content === "string") return payload.content;
  return null;
}
