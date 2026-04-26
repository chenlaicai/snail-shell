import type {
  MessageContentBlock,
  Conversation,
  Message,
  MessagePart,
  MessagePartPayload,
  PersistedMessagePartRow,
  MessageRole,
  MessageWithParts,
  RuntimeSessionBinding,
  SnailName,
  Stage,
} from "./types";

export function parseJsonArray<T extends string>(value: string | null): T[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseJsonRecord<T>(value: string | null): Record<string, T> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, T>
      : {};
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
    ...(row as Omit<Message, "to_snails">),
    to_snails: parseJsonArray<SnailName>(row.to_snails as string | null),
  };
}

export function serializeMessagePartPayload(payload: MessagePartPayload): string {
  return JSON.stringify(payload);
}

export function deserializeMessagePartPayload(value: string): MessagePartPayload {
  return JSON.parse(value) as MessagePartPayload;
}

export function mapMessagePart(row: PersistedMessagePartRow): MessagePart {
  return {
    id: row.id,
    message_id: row.message_id,
    kind: row.kind,
    payload: deserializeMessagePartPayload(row.payload),
    created_at: row.created_at,
  } as MessagePart;
}

export function buildFtsQuery(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/"/g, '""').trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return '""';
  }

  return tokens.map((token) => `"${token}"`).join(" AND ");
}

export function normalizeSnippet(snippet: string): string {
  return snippet.replace(/\s+/g, " ").trim();
}

export function buildSearchableMessageContent(
  role: MessageRole,
  parts: MessagePart[]
): string {
  const resultContent = parts
    .filter((part) => part.kind === "result")
    .map((part) => part.payload)
    .map(extractSearchableResultText)
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const errorContent = parts
    .filter((part) => part.kind === "delta")
    .map((part) => part.payload)
    .map(extractSearchableDeltaErrorText)
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (role === "user" || role === "system") {
    return resultContent;
  }

  if (role === "assistant") {
    return resultContent || errorContent;
  }

  return "";
}

function extractSearchableResultText(payload: MessagePartPayload): string {
  if ((payload as any)?.format !== "blocks") return "";
  const resultPayload = payload as { format: "blocks"; fallback_text?: string; blocks: MessageContentBlock[] };
  if (resultPayload.fallback_text) return resultPayload.fallback_text;
  return resultPayload.blocks
    .flatMap(extractSearchableBlockText)
    .filter(Boolean)
    .join("\n\n");
}

function extractSearchableBlockText(block: MessageContentBlock): string[] {
  switch (block.type) {
    case "text":
    case "rich_text":
    case "markdown":
      return [block.text];
    case "question":
      return [block.title, block.question];
    case "question_response":
      return [block.summary];
    case "image":
      return [block.alt || ""];
    case "icon":
      return [block.label || block.name];
    case "chart":
      return [block.title || ""];
    case "table":
      return [block.title || "", block.columns.join(" ")];
    case "tool_call_card":
      return [block.summary || block.detail || block.tool_name];
    case "artifact_card":
      return [block.title, block.summary || ""];
    case "reference_card":
      return [block.title, block.summary || ""];
    default:
      return [];
  }
}

function extractSearchableDeltaErrorText(payload: MessagePartPayload): string {
  switch ((payload as any)?.kind) {
    case "error_observation":
      return (payload as any).error_text ?? "";
    case "tool_result":
    case "mcp_result":
    case "skill_result":
      return (payload as any).is_error ? ((payload as any).error_text ?? "") : "";
    default:
      return "";
  }
}

export function attachMessageParts(
  messages: Message[],
  getMessageParts: (messageId: number) => MessageWithParts["parts"]
): MessageWithParts[] {
  return messages.map((message) => ({
    ...message,
    parts: getMessageParts(message.id),
  })) as MessageWithParts[];
}
