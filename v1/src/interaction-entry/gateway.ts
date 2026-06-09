import type { RealtimeConversationEvent } from "../agent/interface";
import { HUMAN_ROLE_NAME } from "../shared/domain-types";
import { summarizeRuntimeError } from "../shared/runtime-error";
import { logger } from "../logger";
import type { WorkspaceManager } from "../workspace-workflow/manager";
import { buildPlainTextEvent, type MessageInputEvent } from "../message-bus/message-events";
import type { RoleName } from "../persistence/store";

const VALID_EVENT_KINDS = ["text", "content_block"];

export interface MessageValidationError {
  invalidTypes: string[];
  message: string;
  hint: string;
}

export interface ConversationSendInput {
  content?: unknown;
  events?: unknown;
  fromRole?: RoleName;
  quotedMessageId?: unknown;
  askerRole?: RoleName | null;
  clientId?: unknown;
}

export type ConversationOutboundEvent = RealtimeConversationEvent & { conversation_id: string };
export type ConversationEventHandler = (event: ConversationOutboundEvent) => void;
export type ConversationBadgeHandler = (payload: { conversation_id: string; issue_id: string | null; stage_id: string | null; boss_pending_count: number }) => void;

export class ConversationGateway {
  private readonly subscribers = new Map<string, Set<ConversationEventHandler>>();

  constructor(private readonly workspaceManager: WorkspaceManager) {
    this.workspaceManager.on("agent-event", (conversationId: string, event: RealtimeConversationEvent) => {
      this.publish(conversationId, { ...event, conversation_id: conversationId });
    });
  }

  normalizeInput(input: ConversationSendInput): { events: MessageInputEvent[]; clientId: string | null; quotedMessageId: number | null; fromRole: RoleName; askerRole: RoleName | null } | { error: MessageValidationError } {
    if (!input.content && !Array.isArray(input.events)) {
      return { error: { invalidTypes: [], message: "content or events is required", hint: "Send plain content or structured content events." } };
    }

    let events: MessageInputEvent[];
    if (Array.isArray(input.events)) {
      const validationError = validateMessageEvents(input.events);
      if (validationError) return { error: validationError };
      events = input.events as MessageInputEvent[];
    } else {
      events = [buildPlainTextEvent(String(input.content ?? ""))];
    }

    return {
      events,
      clientId: normalizeClientId(input.clientId),
      quotedMessageId: normalizeQuotedMessageId(input.quotedMessageId),
      fromRole: input.fromRole ?? HUMAN_ROLE_NAME,
      askerRole: input.askerRole ?? null,
    };
  }

  async sendMessage(conversationId: string, input: ConversationSendInput): Promise<{ messageIds: number[] } | { error: MessageValidationError }> {
    const normalized = this.normalizeInput(input);
    if ("error" in normalized) return normalized;

    return this.workspaceManager.sendStructuredMessage(
      conversationId,
      normalized.events,
      { fromRole: normalized.fromRole, quotedMessageId: normalized.quotedMessageId, askerRole: normalized.askerRole, clientId: normalized.clientId }
    );
  }

  sendMessageAsync(conversationId: string, input: ConversationSendInput, onError: (error: string, clientId: string | null) => void): void {
    const normalized = this.normalizeInput(input);
    if ("error" in normalized) {
      onError(normalized.error.message, typeof input.clientId === "string" ? input.clientId : null);
      return;
    }

    this.workspaceManager.sendStructuredMessage(
      conversationId,
      normalized.events,
      { fromRole: normalized.fromRole, quotedMessageId: normalized.quotedMessageId, askerRole: normalized.askerRole, clientId: normalized.clientId }
    ).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Conversation gateway async send failed", { conversationId, error: message });
      onError(summarizeRuntimeError(message), normalized.clientId);
    });
  }

  subscribe(conversationId: string, handler: ConversationEventHandler): () => void {
    const handlers = this.subscribers.get(conversationId) ?? new Set<ConversationEventHandler>();
    handlers.add(handler);
    this.subscribers.set(conversationId, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.subscribers.delete(conversationId);
    };
  }

  onBadge(handler: ConversationBadgeHandler): () => void {
    this.workspaceManager.on("conversation-badge", handler);
    return () => this.workspaceManager.off("conversation-badge", handler);
  }

  getBackfill(conversationId: string, afterEventId: number): ConversationOutboundEvent[] {
    const subscribedEventId = this.workspaceManager.getLastConversationEventId(conversationId);
    if (subscribedEventId <= afterEventId) return [];
    return this.workspaceManager.getConversationEventsBetween(conversationId, afterEventId, subscribedEventId)
      .map((event) => ({ type: "message_event_appended", conversation_id: conversationId, message_id: event.message_id, role_name: event.message_from_role ?? "System", event }));
  }

  private publish(conversationId: string, event: ConversationOutboundEvent): void {
    const handlers = this.subscribers.get(conversationId);
    if (!handlers) return;
    for (const handler of handlers) handler(event);
  }
}

function normalizeClientId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeQuotedMessageId(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

export function validateMessageEvents(events: unknown[]): MessageValidationError | null {
  const invalidParts = events.filter((part: any) => part?.kind && !VALID_EVENT_KINDS.includes(part.kind));
  if (invalidParts.length > 0) {
    const invalidTypes = [...new Set(invalidParts.map((part: any) => part.kind))];
    return {
      invalidTypes,
      message: `Invalid message event kind(s): ${invalidTypes.join(", ")}. Supported kinds: ${VALID_EVENT_KINDS.join(", ")}`,
      hint: "External message input only supports content events.",
    };
  }

  if (events.length === 0) {
    return {
      invalidTypes: [],
      message: "Messages must contain at least one content event",
      hint: "Send a text or content_block event.",
    };
  }

  return null;
}
