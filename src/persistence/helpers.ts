import type {
  Conversation,
  MessagePart,
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
  parts: Array<Pick<MessagePart, "part_type" | "text_value" | "ref_value">>
): string {
  const partText = parts
    .map((part) => {
      if (part.part_type === "mention") {
        return part.text_value ?? part.ref_value ?? "";
      }
      return part.text_value ?? "";
    })
    .filter(Boolean);

  if (role === "user") {
    return partText
      .join("\n\n")
      .trim();
  }

  if (role === "assistant") {
    const result = parts
      .filter((part) => part.part_type === "result")
      .map((part) => part.text_value ?? "")
      .join("\n\n")
      .trim();
    if (result) {
      return result;
    }
  }

  return "";
}

export function attachMessageParts(
  messages: Array<{ id: number }>,
  getMessageParts: (messageId: number) => MessageWithParts["parts"]
): MessageWithParts[] {
  return messages.map((message) => ({
    ...message,
    parts: getMessageParts(message.id),
  })) as MessageWithParts[];
}
