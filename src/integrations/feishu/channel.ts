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

export class FeishuConversationChannel {
  private readonly bindings: FeishuBinding[];
  private readonly unsubscriptions: Array<() => void> = [];
  private readonly processedInboundMessageIds = new Set<string>();

  constructor(
    private readonly config: FeishuConfig,
    private readonly gateway: ConversationGateway,
    private readonly transport: FeishuTransport
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
        void this.handleOutboundEvent(binding, event);
      }));
    }

    await this.transport.start({ onMessage: (message) => this.handleInboundMessage(message) });
    logger.info("Feishu conversation channel started", { bindings: this.bindings.length });
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.unsubscriptions.splice(0)) unsubscribe();
    await this.transport.stop?.();
  }

  private async handleInboundMessage(message: FeishuInboundMessage): Promise<void> {
    const binding = this.resolveBinding(message);
    if (!binding) {
      logger.warn("Feishu message ignored because no conversation binding matched", { chatId: message.chatId, tenantKey: message.tenantKey });
      return;
    }

    const clientId = `feishu:${message.tenantKey ?? "unknown"}:${message.chatId}:${message.messageId}`;
    if (this.processedInboundMessageIds.has(clientId)) return;
    this.processedInboundMessageIds.add(clientId);

    const result = await this.gateway.sendMessage(binding.conversationId, {
      content: message.text,
      fromSnail: "Boss Snail",
      clientId,
    });

    if ("error" in result) {
      logger.warn("Feishu inbound message rejected by conversation gateway", { conversationId: binding.conversationId, error: result.error.message });
    }
  }

  private resolveBinding(message: FeishuInboundMessage): FeishuBinding | null {
    return this.bindings.find((binding) => {
      if (binding.chatId !== message.chatId) return false;
      return !binding.tenantKey || !message.tenantKey || binding.tenantKey === message.tenantKey;
    }) ?? null;
  }

  private async handleOutboundEvent(binding: FeishuBinding, event: ConversationOutboundEvent): Promise<void> {
    if (event.type !== "message_event_appended") return;
    if (!this.config.message_push.include_user_messages && event.snail_name === "Boss Snail") return;
    if (event.event.kind !== "text" && event.event.kind !== "content_block") return;

    const text = renderFeishuTextMessage({
      snailName: event.snail_name,
      events: [event.event],
      maxLength: this.config.message_push.max_text_length,
    });

    await this.transport.sendText({
      chatId: binding.chatId,
      text,
      uuid: `snail-${event.message_id}-${event.event.id}`.slice(0, 50),
    });
  }
}
