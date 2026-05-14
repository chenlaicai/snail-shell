import type {
  ContentBlockEventPayload,
  Conversation,
  ErrorEventPayload,
  Message,
  MessageContext,
  MessageContentBlock,
  MessageEvent,
  MessageEventCategory,
  MessageEventKind,
  MessageEventPayload,
  MessageEventSource,
  MessageRole,
  MessageRuntime,
  MessageWithEvents,
  PersistedMessageEventRow,
  RuntimeSessionBinding,
  SnailName,
  Stage,
  TextEventPayload,
  ToolResultEventPayload,
  CommandResultEventPayload,
} from "./types";
import type { KnowledgeGovernance, KnowledgeGovernanceConversation } from "./knowledge-types";

export function parseJsonArray<T extends string>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseJsonRecord<T>(value: string | null): Record<string, T> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, T> : {};
  } catch {
    return {};
  }
}

export function mapStage(row: Record<string, unknown>): Stage {
  return {
    ...(row as Omit<Stage, "formal_artifacts">),
    formal_artifacts: parseJsonArray<string>(row.formal_artifacts as string | null),
  };
}

export function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    ...(row as Omit<Conversation, "participating_snails" | "from_conversation_ids" | "runtime_sessions">),
    participating_snails: parseJsonArray<SnailName>(row.participating_snails as string | null),
    from_conversation_ids: parseJsonArray<string>(row.from_conversation_ids as string | null),
    runtime_sessions: parseJsonRecord<RuntimeSessionBinding>(row.runtime_sessions as string | null) as Partial<Record<SnailName, RuntimeSessionBinding>>,
  };
}

export function mapMessage(row: Record<string, unknown>): Message {
  return {
    ...(row as Omit<Message, "to_snails" | "runtime">),
    to_snails: parseJsonArray<SnailName>(row.to_snails as string | null),
    runtime: row.runtime as MessageRuntime | null,
  };
}

export function mapMessageContext(row: Record<string, unknown>): MessageContext {
  return row as unknown as MessageContext;
}

export function mapKnowledgeGovernance(row: Record<string, unknown>, conversation: KnowledgeGovernanceConversation | null = null): KnowledgeGovernance {
  return {
    ...(row as Omit<KnowledgeGovernance, "related_knowledge_ids" | "runtime_feedback_allowed" | "runtime_feedback_channels" | "conversation">),
    related_knowledge_ids: parseJsonArray<string>(row.related_knowledge_ids as string | null),
    runtime_feedback_allowed: Boolean(row.runtime_feedback_allowed),
    runtime_feedback_channels: parseJsonArray<string>(row.runtime_feedback_channels as string | null),
    conversation,
  };
}

export function mapKnowledgeGovernanceConversation(row: Record<string, unknown>): KnowledgeGovernanceConversation {
  return {
    ...(row as Omit<KnowledgeGovernanceConversation, "participating_snails">),
    participating_snails: parseJsonArray<string>(row.participating_snails as string | null),
  };
}

export function defaultEventSource(source: Partial<MessageEventSource> = {}): MessageEventSource {
  return {
    runtime_name: source.runtime_name ?? null,
    runtime_event_type: source.runtime_event_type ?? null,
    runtime_message_id: source.runtime_message_id ?? null,
    runtime_item_id: source.runtime_item_id ?? null,
    runtime_call_id: source.runtime_call_id ?? null,
    raw_event: source.raw_event ?? null,
    metadata: source.metadata ?? null,
  };
}

export function eventCategoryForKind(kind: MessageEventKind): MessageEventCategory {
  return kind === "start" || kind === "signal" || kind === "error" ? "signal" : "content";
}

export function serializeMessageEventPayload(payload: MessageEventPayload): string {
  return JSON.stringify(payload);
}

export function deserializeMessageEventPayload(value: string): MessageEventPayload {
  return JSON.parse(value) as MessageEventPayload;
}

export function serializeMessageEventSource(source: MessageEventSource): string {
  return JSON.stringify(source);
}

export function deserializeMessageEventSource(value: string): MessageEventSource {
  return defaultEventSource(JSON.parse(value) as Partial<MessageEventSource>);
}

export function mapMessageEvent(row: PersistedMessageEventRow): MessageEvent {
  return {
    id: row.id,
    message_id: row.message_id,
    seq: row.seq,
    category: row.category,
    kind: row.kind,
    payload: deserializeMessageEventPayload(row.payload),
    source: deserializeMessageEventSource(row.source),
    created_at: row.created_at,
  } as MessageEvent;
}

export function buildFtsQuery(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/"/g, '""').trim())
    .filter(Boolean);

  if (tokens.length === 0) return '""';
  return tokens.map((token) => `"${token}"`).join(" AND ");
}

export function normalizeSnippet(snippet: string): string {
  return snippet.replace(/\s+/g, " ").trim();
}

export function buildSearchableMessageContent(_role: MessageRole, context: MessageContext | null, events: MessageEvent[]): string {
  const normalizedContext = context?.context?.trim();
  if (normalizedContext) return normalizedContext;
  return events
    .flatMap(extractSearchableEventText)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractSearchableEventText(event: MessageEvent): string[] {
  switch (event.kind) {
    case "text":
      return [(event.payload as TextEventPayload).text];
    case "content_block": {
      const payload = event.payload as ContentBlockEventPayload;
      return [payload.fallback_text ?? "", ...payload.blocks.flatMap(extractSearchableBlockText)];
    }
    case "tool_result": {
      const payload = event.payload as ToolResultEventPayload;
      return [payload.output_text ?? "", payload.is_error ? payload.error_text ?? "" : ""];
    }
    case "command_result": {
      const payload = event.payload as CommandResultEventPayload;
      return [payload.output_text ?? ""];
    }
    case "error":
      return [(event.payload as ErrorEventPayload).message];
    default:
      return [];
  }
}

export function extractSearchableBlockText(block: MessageContentBlock): string[] {
  switch (block.type) {
    case "text":
    case "rich_text":
    case "markdown":
      return [block.text];
    case "question":
      return [block.title, block.question, block.reason ?? "", ...block.options.flatMap((option) => [option.label, option.description ?? ""] )];
    case "question_response":
      return [block.summary, ...block.selected_options.flatMap((option) => [option.label, option.extra_text ?? ""] )];
    case "image":
      return [block.alt ?? ""];
    case "icon":
      return [block.label ?? block.name];
    case "chart":
      return [block.title ?? ""];
    case "table":
      return [block.title ?? "", block.columns.join(" ")];
    case "tool_call_card":
      return [block.summary ?? block.detail ?? block.tool_name];
    case "artifact_card":
      return [block.title, block.summary ?? ""];
    case "reference_card":
      return [block.title, block.summary ?? ""];
  }
}

export function attachMessageEvents(
  messages: Message[],
  getMessageEvents: (messageId: number) => MessageWithEvents["events"],
  getMessageContext: (messageId: number) => MessageWithEvents["context"] = () => null
): MessageWithEvents[] {
  return messages.map((message) => ({
    ...message,
    events: getMessageEvents(message.id),
    context: getMessageContext(message.id),
  }));
}
