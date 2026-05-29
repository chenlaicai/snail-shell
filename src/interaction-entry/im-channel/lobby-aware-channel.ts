import { logger } from "../../logger";
import type { LobbyRouter } from "../../lobby/router";
import type { LobbyResponseRenderer } from "../../lobby/response-renderer";
import type { LobbySession } from "../../lobby/types";
import type { LobbySessionStore } from "../../lobby/session-store";
import type { ConversationGateway, ConversationOutboundEvent } from "../gateway";
import type { FeishuInboundMessage, FeishuTransport } from "../feishu/channel";
import type { IMChannelAdapter } from "./interface";

export interface LobbyAwareChannelConfig {
  channelType: string;
  maxTextLength: number;
  includeUserMessages: boolean;
  /** 允许接入大厅的飞书群白名单，未匹配的消息会被忽略 */
  lobbyBindings: Array<{ tenant_key?: string; chat_id: string }>;
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
  sessionStore: LobbySessionStore;
}

const INBOUND_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PROCESSED_INBOUND_MESSAGES = 10000;

export class LobbyAwareChannel implements IMChannelAdapter {
  readonly channelType: string;
  /** conversationId → 订阅该 conversation 的 chatId 集合及取消函数 */
  private readonly conversationSubscriptions = new Map<string, { chatIds: Set<string>; unsubscribe: () => void }>();
  /** sessionId → 当前订阅的 conversationId，用于检测导航变化后取消旧订阅 */
  private readonly sessionToConversation = new Map<string, string>();
  /** chatId → 该群当前订阅的 conversationId 集合（反向索引），用于 Web UI 清理时快速定位需要退订的 conversation */
  private readonly chatIdToConversations = new Map<string, Set<string>>();
  /** 飞书入站去重：已确认处理的 clientId 及时间戳 */
  private readonly processedInbound = new Map<string, { processedAt: number }>();
  /** 飞书入站去重：正在处理中的 clientId，防止并发重复投递 */
  private readonly pendingInbound = new Set<string>();

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
    /**
     * 重启后 DB 中仍在 in_conversation 的会话位置已持久化，但 gateway 出站订阅是进程内状态。
     * 启动时 rehydrate 订阅，确保 Agent 回复能推送到已进入房间的 IM 群，无需等待群再次发消息触发。
     */
    this.rehydrateSubscriptions();
    logger.info("Lobby-aware IM channel started", { channelType: this.channelType });
  }

  /** 从 DB 恢复仍在 in_conversation 的会话出站订阅，跳过不在白名单中的群 */
  private rehydrateSubscriptions(): void {
    const activeSessions = this.deps.sessionStore.getActiveConversations(this.config.channelType);
    let rehydrated = 0;
    for (const session of activeSessions) {
      if (!this.isAllowedBinding({ chatId: session.channel_chat_id, tenantKey: session.channel_tenant_key })) continue;
      this.ensureSubscribed(session);
      rehydrated++;
    }
    if (rehydrated > 0) {
      logger.info("Rehydrated lobby subscriptions from persisted sessions", { count: rehydrated });
    }
  }

  async stop(): Promise<void> {
    for (const { unsubscribe } of this.conversationSubscriptions.values()) unsubscribe();
    this.conversationSubscriptions.clear();
    this.sessionToConversation.clear();
    this.chatIdToConversations.clear();
    this.processedInbound.clear();
    this.pendingInbound.clear();
    await this.deps.transport.stop?.();
  }

  private scheduleInbound(message: FeishuInboundMessage): void {
    void this.handleInbound(message).catch((error: unknown) => {
      logger.error("Lobby inbound message processing failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }

  private async handleInbound(message: FeishuInboundMessage): Promise<void> {
    /** 大厅只处理 lobby_bindings 白名单中的群消息，未配置的群忽略 */
    if (!this.isAllowedBinding(message)) {
      logger.warn("Lobby inbound ignored: chat not in lobby_bindings", { chatId: message.chatId, tenantKey: message.tenantKey });
      return;
    }

    /**
     * 飞书会在 ack 超时或链路失败时重试同一 message_id。使用 tenant/chat/messageId 构成稳定 clientId，
     * 与旧 FeishuConversationChannel 保持相同去重语义：pending 防并发重复，processed 防确认后重试。
     */
    const clientId = `feishu:${message.tenantKey ?? "unknown"}:${message.chatId}:${message.messageId}`;
    this.pruneProcessedInbound(Date.now());
    if (this.processedInbound.has(clientId) || this.pendingInbound.has(clientId)) return;
    this.pendingInbound.add(clientId);

    try {
      await this.processAllowedInbound(message, clientId);
    } finally {
      this.pendingInbound.delete(clientId);
    }
  }

  /** 已通过绑定白名单和去重校验的入站消息处理 */
  private async processAllowedInbound(message: FeishuInboundMessage, clientId: string): Promise<void> {
    const previousConversationId = this.sessionToConversation.get(
      `${this.config.channelType}:${message.chatId}:${message.tenantKey ?? ""}`
    );

    const result = await this.deps.lobbyRouter.processInbound({
      channelType: this.config.channelType,
      channelChatId: message.chatId,
      channelTenantKey: message.tenantKey,
      text: message.text,
    });

    /**
     * 已确认处理成功后标记去重；在此之前若处理失败，pending 会被 finally 清除，
     * 允许飞书重试时重新处理——与旧通道的"成功后才去重"策略一致。
     */
    this.processedInbound.set(clientId, { processedAt: Date.now() });
    this.pruneProcessedInbound(Date.now());

    if ("forwarded" in result) {
      this.ensureSubscribed(result.session);
      this.handleSubscriptionCleanup(result.session, previousConversationId);
      return;
    }

    const responseText = result.response.text;
    if (responseText) {
      await this.deps.transport.sendText({ chatId: message.chatId, text: responseText });
    }

    if (result.session.current_conversation_id) {
      this.ensureSubscribed(result.session);
    }
    this.handleSubscriptionCleanup(result.session, previousConversationId);
  }

  /** 检查消息来源是否在 lobby_bindings 白名单中 */
  private isAllowedBinding(source: { chatId: string; tenantKey: string | null }): boolean {
    return this.config.lobbyBindings.some((binding) => {
      if (binding.chat_id !== source.chatId) return false;
      return binding.tenant_key ? binding.tenant_key === source.tenantKey : true;
    });
  }

  /**
   * 导航离开旧 conversation 时取消对应的出站订阅。
   * 确保 /back 或 /lobby 退出房间后不再收到旧 conversation 的 Agent 回复。
   */
  private handleSubscriptionCleanup(session: LobbySession, previousConversationId: string | undefined): void {
    const sessionKey = `${session.channel_type}:${session.channel_chat_id}:${session.channel_tenant_key ?? ""}`;
    const currentConversationId = session.current_conversation_id ?? null;

    if (currentConversationId) {
      this.sessionToConversation.set(sessionKey, currentConversationId);
    } else {
      this.sessionToConversation.delete(sessionKey);
    }

    if (previousConversationId && previousConversationId !== currentConversationId) {
      this.ensureUnsubscribed(previousConversationId, session.channel_chat_id);
    }
  }

  private pruneProcessedInbound(now: number): void {
    for (const [clientId, entry] of this.processedInbound) {
      if (now - entry.processedAt > INBOUND_DEDUPE_TTL_MS) this.processedInbound.delete(clientId);
    }
    while (this.processedInbound.size > MAX_PROCESSED_INBOUND_MESSAGES) {
      const oldest = this.processedInbound.keys().next().value as string | undefined;
      if (!oldest) break;
      this.processedInbound.delete(oldest);
    }
  }

  /**
   * 确保已订阅指定 conversation 的出站事件。
   * 同一 conversation 可被多个 IM 群进入（各自独立 session），出站事件需推送到所有已订阅的群。
   */
  private ensureSubscribed(session: LobbySession): void {
    const conversationId = session.current_conversation_id;
    if (!conversationId) return;

    const chatId = session.channel_chat_id;
    const existing = this.conversationSubscriptions.get(conversationId);
    if (existing) {
      existing.chatIds.add(chatId);
      this.addChatToConversationMapping(chatId, conversationId);
      return;
    }

    const chatIds = new Set<string>([chatId]);
    const unsubscribe = this.deps.gateway.subscribe(conversationId, (event) => {
      for (const targetChatId of chatIds) {
        this.scheduleOutbound(targetChatId, event);
      }
    });
    this.conversationSubscriptions.set(conversationId, { chatIds, unsubscribe });
    this.addChatToConversationMapping(chatId, conversationId);
  }

  /**
   * 从指定 conversation 订阅中移除一个 chatId。
   * 当该 conversation 不再有任何订阅者时，取消 gateway 订阅并清理映射。
   */
  private ensureUnsubscribed(conversationId: string, chatId: string): void {
    const sub = this.conversationSubscriptions.get(conversationId);
    if (!sub) return;
    sub.chatIds.delete(chatId);
    this.removeChatFromConversationMapping(chatId, conversationId);
    if (sub.chatIds.size === 0) {
      sub.unsubscribe();
      this.conversationSubscriptions.delete(conversationId);
    }
  }

  private addChatToConversationMapping(chatId: string, conversationId: string): void {
    let set = this.chatIdToConversations.get(chatId);
    if (!set) { set = new Set(); this.chatIdToConversations.set(chatId, set); }
    set.add(conversationId);
  }

  private removeChatFromConversationMapping(chatId: string, conversationId: string): void {
    const set = this.chatIdToConversations.get(chatId);
    if (!set) return;
    set.delete(conversationId);
    if (set.size === 0) this.chatIdToConversations.delete(chatId);
  }

  /**
   * Web UI 重置/删除 session 时调用，清理该 session 对应 chatId 的所有出站订阅。
   * 解决 Web 端操作不经过 IM 入站路径、通道进程内订阅状态不会自动清理的问题。
   */
  cleanupSessionSubscriptions(session: LobbySession): void {
    const chatId = session.channel_chat_id;
    const conversationIds = this.chatIdToConversations.get(chatId);
    if (!conversationIds) return;
    for (const conversationId of [...conversationIds]) {
      this.ensureUnsubscribed(conversationId, chatId);
    }
    const sessionKey = `${session.channel_type}:${chatId}:${session.channel_tenant_key ?? ""}`;
    this.sessionToConversation.delete(sessionKey);
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
