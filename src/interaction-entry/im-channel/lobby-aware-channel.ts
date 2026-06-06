import { logger } from "../../logger";
import { HUMAN_ROLE_NAME } from "../../shared/domain-types";
import type { LobbyRouter } from "../../lobby/router";
import type { LobbyResponseRenderer } from "../../lobby/response-renderer";
import type { LobbySession } from "../../lobby/types";
import type { LobbySessionStore } from "../../lobby/session-store";
import type { ConversationGateway, ConversationOutboundEvent } from "../gateway";
import type { IMInboundMessage, IMTransport } from "./types";
import { StreamingSession } from "./streaming-session";
import type { IMChannelAdapter } from "./interface";

export interface LobbyAwareChannelConfig {
  channelType: string;
  maxTextLength: number;
  /** 允许接入大厅的 IM 群白名单，未匹配的消息会被忽略 */
  allowedChats: Array<{ tenant_key?: string; chat_id: string }>;
  /** 是否启用流式响应。未配置时默认 false（向后兼容） */
  streamingEnabled?: boolean;
  /** 流式更新 debounce 间隔（ms），未配置时默认 300，最小 100 */
  streamingFlushIntervalMs?: number;
}

/**
 * 大厅感知的 IM 通道。
 * 替代 FeishuConversationChannel，消息先经过 LobbyRouter 决定去向：
 * - 大厅命令 → 本地处理并返回响应
 * - 房间内消息 → 转发到 ConversationGateway
 */
export interface LobbyAwareChannelDeps {
  transport: IMTransport;
  lobbyRouter: LobbyRouter;
  gateway: ConversationGateway;
  responseRenderer: LobbyResponseRenderer;
  sessionStore: LobbySessionStore;
}

const INBOUND_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PROCESSED_INBOUND_MESSAGES = 10000;
/** 转发消息来源追踪上限，超出时淘汰最旧条目 */
const MAX_FORWARDED_MESSAGE_TRACKING = 5000;

export class LobbyAwareChannel implements IMChannelAdapter {
  readonly channelType: string;
  /** conversationId → 订阅该 conversation 的 chatId 集合及取消函数 */
  private readonly conversationSubscriptions = new Map<string, { chatIds: Set<string>; unsubscribe: () => void }>();
  /** sessionId → 当前订阅的 conversationId，用于检测导航变化后取消旧订阅 */
  private readonly sessionToConversation = new Map<string, string>();
  /** chatId → 该群当前订阅的 conversationId 集合（反向索引），用于 Web UI 清理时快速定位需要退订的 conversation */
  private readonly chatIdToConversations = new Map<string, Set<string>>();
  /** IM 入站去重：已确认处理的 clientId 及时间戳 */
  private readonly processedInbound = new Map<string, { processedAt: number }>();
  /** IM 入站去重：正在处理中的 clientId，防止并发重复投递 */
  private readonly pendingInbound = new Set<string>();
  /**
   * 转发消息来源追踪：messageId → sourceChatId。
   * 用于 per-chat echo prevention：同一 chat 转发的 Boss Role 消息不应回显到该 chat，
   * 但其他 entry point（Web UI、其他飞书群）的 Boss Role 消息应正常同步。
   */
  private readonly recentForwardedMessages = new Map<number, string>();
  /** conversationId:messageId → 流式会话 */
  private readonly streamingSessions = new Map<string, StreamingSession>();

  /**
   * 正在处理转发的来源 chatId，用于修复 echo prevention 时序问题。
   *
   * Why: gateway.sendMessage 内部同步 emit message_event_appended 事件，
   * 出站 handler 在 router.processInbound() 返回前就已触发，此时
   * recentForwardedMessages 尚未被 trackForwardedMessages 填充。
   * 通过在 router.processInbound() 调用前设置此标记，出站 handler
   * 可以在 recentForwardedMessages 查找失败时回退到此标记判断是否为回显。
   */
  private pendingForwardChatId: string | null = null;

  constructor(
    private readonly config: LobbyAwareChannelConfig,
    private readonly deps: LobbyAwareChannelDeps,
  ) {
    this.channelType = config.channelType;
  }

  async start(): Promise<void> {
    this.deps.transport.onMessage((message) => this.scheduleInbound(message));
    /**
     * 重启后 DB 中仍在 in_conversation 的会话位置已持久化，但 gateway 出站订阅是进程内状态。
     * 启动时 rehydrate 订阅，确保 Agent 回复能推送到已进入房间的 IM 群，无需等待群再次发消息触发。
     */
    this.rehydrateSubscriptions();
    logger.info("Lobby-aware IM channel started", { channelType: this.channelType });
  }

  /**
   * 从 DB 恢复仍在 in_conversation 的会话出站订阅，跳过不在白名单中的群。
   * 同时恢复 sessionToConversation 索引，确保重启后首次 /back 或 /lobby 能正确退订旧 conversation。
   */
  private rehydrateSubscriptions(): void {
    const activeSessions = this.deps.sessionStore.getActiveConversations(this.config.channelType);
    let rehydrated = 0;
    for (const session of activeSessions) {
      if (!this.isAllowedBinding({ chatId: session.channel_chat_id, tenantKey: session.channel_tenant_key })) continue;
      this.ensureSubscribed(session);
      /** 恢复 session→conversation 索引，否则重启后 /back 无法定位旧订阅进行退订 */
      if (session.current_conversation_id) {
        const sessionKey = `${session.channel_type}:${session.channel_chat_id}:${session.channel_tenant_key ?? ""}`;
        this.sessionToConversation.set(sessionKey, session.current_conversation_id);
      }
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
    this.recentForwardedMessages.clear();
    // 清理流式会话的 pending timer
    for (const session of this.streamingSessions.values()) session.dispose();
    this.streamingSessions.clear();
    await this.deps.transport.stop?.();
  }

  private scheduleInbound(message: IMInboundMessage): void {
    void this.handleInbound(message).catch((error: unknown) => {
      logger.error("Lobby inbound message processing failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }

  private async handleInbound(message: IMInboundMessage): Promise<void> {
    /** 大厅只处理 allowed_chats 白名单中的群消息，未配置的群忽略 */
    if (!this.isAllowedBinding(message)) {
      logger.warn("Lobby inbound ignored: chat not in allowed_chats", { chatId: message.chatId, tenantKey: message.tenantKey });
      return;
    }

    /**
     * 飞书会在 ack 超时或链路失败时重试同一 message_id。使用 tenant/chat/messageId 构成稳定 clientId，
     * 与旧 FeishuConversationChannel 保持相同去重语义：pending 防并发重复，processed 防确认后重试。
     */
    const clientId = `${this.config.channelType}:${message.tenantKey ?? "unknown"}:${message.chatId}:${message.messageId}`;
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
  private async processAllowedInbound(message: IMInboundMessage, clientId: string): Promise<void> {
    const previousConversationId = this.sessionToConversation.get(
      `${this.config.channelType}:${message.chatId}:${message.tenantKey ?? ""}`
    );

    /**
     * 在 router.processInbound() 前设置 pending 标记。
     * gateway.sendMessage 内部同步 emit 出站事件，出站 handler 在 processInbound 返回前触发，
     * 此时 recentForwardedMessages 尚未填充——pendingForwardChatId 作为回退判断依据。
     */
    this.pendingForwardChatId = message.chatId;

    let result: Awaited<ReturnType<typeof this.deps.lobbyRouter.processInbound>>;
    try {
      result = await this.deps.lobbyRouter.processInbound({
        channelType: this.config.channelType,
        channelChatId: message.chatId,
        channelTenantKey: message.tenantKey,
        text: message.text,
      });
    } finally {
      this.pendingForwardChatId = null;
    }

    /**
     * 已确认处理成功后标记去重；在此之前若处理失败，pending 会被 finally 清除，
     * 允许飞书重试时重新处理——与旧通道的"成功后才去重"策略一致。
     */
    this.processedInbound.set(clientId, { processedAt: Date.now() });
    this.pruneProcessedInbound(Date.now());

    if ("forwarded" in result) {
      this.ensureSubscribed(result.session);
      this.trackForwardedMessages(result.messageIds, message.chatId);
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

  /** 记录转发消息的 messageId → sourceChatId，用于 per-chat echo prevention */
  private trackForwardedMessages(messageIds: number[], sourceChatId: string): void {
    for (const messageId of messageIds) {
      this.recentForwardedMessages.set(messageId, sourceChatId);
    }
    // 淘汰超出上限的最旧条目
    while (this.recentForwardedMessages.size > MAX_FORWARDED_MESSAGE_TRACKING) {
      const oldest = this.recentForwardedMessages.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.recentForwardedMessages.delete(oldest);
    }
  }

  /** 检查消息来源是否在 allowed_chats 白名单中 */
  private isAllowedBinding(source: { chatId: string; tenantKey: string | null }): boolean {
    return this.config.allowedChats.some((binding) => {
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
    // 清理该 chatId 关联的流式会话，防止孤儿 session 的 timer 继续触发 PATCH
    for (const [key, streamingSession] of [...this.streamingSessions.entries()]) {
      if (streamingSession.chatId === chatId) {
        streamingSession.dispose();
        this.streamingSessions.delete(key);
      }
    }
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
    // echo prevention：所有事件类型统一前置检查。
    // message_started/message_status_changed 理论上只由 assistant role 触发（human role 不会产生），
    // 但不依赖此隐式假设——统一检查保证安全性。
    if (event.role_name === HUMAN_ROLE_NAME) {
      const sourceChatId = this.recentForwardedMessages.get(event.message_id);
      if (sourceChatId === chatId) {
        this.recentForwardedMessages.delete(event.message_id);
        return;
      }
      if (this.pendingForwardChatId === chatId) return;
    }

    if (!this.config.streamingEnabled) {
      await this.handleOutboundLegacy(chatId, event);
      return;
    }

    await this.handleOutboundStreaming(chatId, event);
  }

  /** 非流式出站路径（streamingEnabled=false）：每个 message_event_appended 独立 sendText */
  private async handleOutboundLegacy(chatId: string, event: ConversationOutboundEvent): Promise<void> {
    if (event.type !== "message_event_appended") return;
    if (event.event.kind !== "text" && event.event.kind !== "content_block") return;
    const rawText = extractEventText(event);
    if (!rawText) return;
    const text = this.deps.responseRenderer.renderOutboundMessage({
      roleName: event.role_name, text: rawText, maxLength: this.config.maxTextLength,
    });
    await this.deps.transport.sendText({ chatId, text });
  }

  /** 流式出站路径（streamingEnabled=true）：占位消息 + debounce PATCH + 最终 PATCH */
  private async handleOutboundStreaming(chatId: string, event: ConversationOutboundEvent): Promise<void> {
    switch (event.type) {
      case "message_started":
        await this.handleStreamingStarted(chatId, event);
        break;
      case "message_event_appended":
        await this.handleStreamingTextDelta(chatId, event);
        break;
      case "message_status_changed":
        await this.handleStreamingEnd(event);
        break;
    }
  }

  private async handleStreamingStarted(chatId: string, event: ConversationOutboundEvent): Promise<void> {
    if (event.type !== "message_started") return;
    const sessionKey = `${event.conversation_id}:${event.message_id}`;
    const flushIntervalMs = Math.max(this.config.streamingFlushIntervalMs ?? 300, 100);
    const session = new StreamingSession(chatId, event.role_name, this.deps.transport, {
      flushIntervalMs,
      maxLength: this.config.maxTextLength,
    });
    this.streamingSessions.set(sessionKey, session);
    try {
      await session.onStart();
    } catch (error) {
      this.streamingSessions.delete(sessionKey);
      // 已知限制：如果 sendText 已成功但后续处理失败，飞书端的"思考中..."占位消息会残留。
      // 后续事件走降级路径（sendText），用户仍能看到内容。占位消息残留是可接受的边缘场景。
      logger.warn("Feishu streaming onStart failed, falling back to non-streaming", {
        chatId, messageId: event.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleStreamingTextDelta(chatId: string, event: ConversationOutboundEvent): Promise<void> {
    if (event.type !== "message_event_appended") return;
    if (event.event.kind !== "text" && event.event.kind !== "content_block") return;
    const rawText = extractEventText(event);
    if (!rawText) return;

    const sessionKey = `${event.conversation_id}:${event.message_id}`;
    const session = this.streamingSessions.get(sessionKey);
    if (session) {
      session.onTextDelta(rawText);
    } else {
      const text = this.deps.responseRenderer.renderOutboundMessage({
        roleName: event.role_name, text: rawText, maxLength: this.config.maxTextLength,
      });
      await this.deps.transport.sendText({ chatId, text });
    }
  }

  private async handleStreamingEnd(event: ConversationOutboundEvent): Promise<void> {
    if (event.type !== "message_status_changed") return;
    const sessionKey = `${event.conversation_id}:${event.message_id}`;
    const session = this.streamingSessions.get(sessionKey);
    if (!session) return;
    const finalText = extractFinalText(event) ?? undefined;
    try {
      await session.onEnd(finalText);
    } finally {
      // 确保 session 从 map 中移除，即使 onEnd 抛出异常也不泄漏
      this.streamingSessions.delete(sessionKey);
    }
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

function extractFinalText(event: ConversationOutboundEvent): string | null {
  if (event.type !== "message_status_changed") return null;
  const raw = (event as Record<string, unknown>).context;
  if (typeof raw !== "object" || raw === null) return null;
  const context = raw as Record<string, unknown>;
  // MCP 显式提交的最终正文优先
  if (context.kind === "mcp_final_body" && typeof context.context === "string") {
    return context.context;
  }
  // auto-extracted context fallback
  if (typeof context.context === "string") {
    return context.context;
  }
  return null;
}
