import { logger } from "../../logger";
import type { ConversationGateway, ConversationOutboundEvent } from "../../conversation/gateway";
import { renderFeishuTextMessage } from "./message-renderer";
import type { FeishuConfig } from "./config";

export interface FeishuInboundMessage {
  tenantKey: string | null;
  chatId: string;
  messageId: string;
  text: string;
}

export interface FeishuTransport {
  start(input: { onMessage: (message: FeishuInboundMessage) => void | Promise<void> }): Promise<void> | void;
  stop?(): Promise<void> | void;
  sendText(input: { chatId: string; text: string; uuid?: string }): Promise<void> | void;
}

interface FeishuBinding {
  tenantKey: string | null;
  chatId: string;
  conversationId: string;
}

interface ProcessedInboundMessage {
  processedAt: number;
}

const DEFAULT_INBOUND_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PROCESSED_INBOUND_MESSAGES = 10000;

export class FeishuConversationChannel {
  private readonly bindings: FeishuBinding[];
  private readonly unsubscriptions: Array<() => void> = [];
  private readonly processedInboundMessages = new Map<string, ProcessedInboundMessage>();
  private readonly pendingInboundMessageIds = new Set<string>();

  constructor(
    private readonly config: FeishuConfig,
    private readonly gateway: ConversationGateway,
    private readonly transport: FeishuTransport,
    private readonly dedupeOptions: { ttlMs?: number; maxEntries?: number } = {}
  ) {
    this.bindings = config.bindings.map((binding) => ({
      tenantKey: binding.tenant_key?.trim() || null,
      chatId: binding.chat_id,
      conversationId: binding.conversation_id,
    }));
  }

  async start(): Promise<void> {
    for (const binding of this.bindings) {
      this.unsubscriptions.push(this.gateway.subscribe(binding.conversationId, (event) => {
        this.scheduleOutboundEvent(binding, event);
      }));
    }

    await this.transport.start({ onMessage: (message) => {
      this.scheduleInboundMessage(message);
    } });
    logger.info("Feishu conversation channel started", { bindings: this.bindings.length });
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.unsubscriptions.splice(0)) unsubscribe();
    await this.transport.stop?.();
  }

  private scheduleInboundMessage(message: FeishuInboundMessage): void {
    void this.handleInboundMessage(message).catch((error: unknown) => {
      logger.error("Feishu inbound message processing failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }

  private async handleInboundMessage(message: FeishuInboundMessage): Promise<void> {
    const binding = this.resolveBinding(message);
    if (!binding) {
      logger.warn("Feishu message ignored because no conversation binding matched", { chatId: message.chatId, tenantKey: message.tenantKey });
      return;
    }

    const clientId = `feishu:${message.tenantKey ?? "unknown"}:${message.chatId}:${message.messageId}`;
    this.pruneProcessedInboundMessages(Date.now());
    if (this.processedInboundMessages.has(clientId) || this.pendingInboundMessageIds.has(clientId)) return;
    this.pendingInboundMessageIds.add(clientId);

    try {
      const result = await this.gateway.sendMessage(binding.conversationId, {
        content: message.text,
        fromSnail: "Boss Snail",
        clientId,
      });

      if ("error" in result) {
        logger.warn("Feishu inbound message rejected by conversation gateway", { conversationId: binding.conversationId, error: result.error.message });
        return;
      }

      /**
       * 飞书会在 ack 超时或链路失败时重试同一 message_id。只有 Snail Shell 成功接收后才能确认去重，
       * 否则临时失败会被进程内状态误吞；同时保留 pending 可避免同一事件在处理中被并发重复投递。
       */
      this.processedInboundMessages.set(clientId, { processedAt: Date.now() });
      this.pruneProcessedInboundMessages(Date.now());
    } finally {
      this.pendingInboundMessageIds.delete(clientId);
    }
  }

  private resolveBinding(message: FeishuInboundMessage): FeishuBinding | null {
    return this.bindings.find((binding) => {
      if (binding.chatId !== message.chatId) return false;
      return binding.tenantKey ? binding.tenantKey === message.tenantKey : true;
    }) ?? null;
  }

  private pruneProcessedInboundMessages(now: number): void {
    const ttlMs = this.dedupeOptions.ttlMs ?? DEFAULT_INBOUND_DEDUPE_TTL_MS;
    const maxEntries = this.dedupeOptions.maxEntries ?? DEFAULT_MAX_PROCESSED_INBOUND_MESSAGES;
    for (const [clientId, entry] of this.processedInboundMessages) {
      if (now - entry.processedAt > ttlMs) this.processedInboundMessages.delete(clientId);
    }
    while (this.processedInboundMessages.size > maxEntries) {
      const oldestClientId = this.processedInboundMessages.keys().next().value as string | undefined;
      if (!oldestClientId) break;
      this.processedInboundMessages.delete(oldestClientId);
    }
  }

  private scheduleOutboundEvent(binding: FeishuBinding, event: ConversationOutboundEvent): void {
    void this.handleOutboundEvent(binding, event).catch((error: unknown) => {
      logger.error("Feishu outbound message push failed", {
        conversationId: binding.conversationId,
        chatId: binding.chatId,
        messageId: event.type === "message_event_appended" ? event.message_id : null,
        eventId: event.type === "message_event_appended" ? event.event.id : null,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async handleOutboundEvent(binding: FeishuBinding, event: ConversationOutboundEvent): Promise<void> {
    if (event.type !== "message_event_appended") return;
    if (!this.config.message_push.include_user_messages && event.snail_name === "Boss Snail") return;
    if (event.event.kind !== "text" && event.event.kind !== "content_block") return;
    const uuid = `snail-${event.message_id}-${event.event.id}`.slice(0, 50);

    const text = renderFeishuTextMessage({
      snailName: event.snail_name,
      events: [event.event],
      maxLength: this.config.message_push.max_text_length,
    });

    await this.transport.sendText({
      chatId: binding.chatId,
      text,
      uuid,
    });
  }
}
