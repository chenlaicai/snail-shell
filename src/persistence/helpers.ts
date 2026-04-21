import type {
  Conversation,
  KnowledgeEntry,
  KnowledgeEvent,
  KnowledgeProposal,
  KnowledgeProposalEvidence,
  KnowledgeProposalReview,
  Message,
  MessagePart,
  MessageRole,
  MessageWithParts,
  QuotedMessagePreview,
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

export function parseJsonObject<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // Ignore malformed persisted JSON and fall back to defaults.
  }

  return fallback;
}

export function mapKnowledgeProposal(row: Record<string, unknown>): KnowledgeProposal {
  return {
    ...(row as Omit<KnowledgeProposal, "review" | "evidence">),
    review: parseJsonObject<KnowledgeProposalReview>(row.review as string | null, {
      suggested_scope: "project_local",
      suggested_authority: "reference",
      confidence: 0,
      why_include: [],
      why_not_include: [],
      risk_if_wrong: "",
      reviewer_mode: "single_model",
      council_views: [],
    }),
    evidence: parseJsonObject<KnowledgeProposalEvidence>(row.evidence as string | null, {
      conversation_ids: [],
      artifact_ids: [],
      formal_artifact_ids: [],
    }),
  };
}

export function mapKnowledgeEntry(row: Record<string, unknown>): KnowledgeEntry {
  return {
    ...(row as Omit<KnowledgeEntry, "evidence">),
    evidence: parseJsonObject<KnowledgeProposalEvidence>(row.evidence as string | null, {
      conversation_ids: [],
      artifact_ids: [],
      formal_artifact_ids: [],
    }),
  };
}

export function mapKnowledgeEvent(row: Record<string, unknown>): KnowledgeEvent {
  return row as unknown as KnowledgeEvent;
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
  parts: Array<Pick<MessagePart, "part_type" | "text_value">>
): string {
  const partText = parts
    .map((part) => part.text_value ?? "")
    .filter(Boolean);

  if (role === "user") {
    return partText.join("\n\n").trim();
  }

  if (role === "assistant") {
    const content = parts
      .filter((part) => part.part_type === "content")
      .map((part) => part.text_value ?? "")
      .join("\n\n")
      .trim();
    if (content) {
      return content;
    }
  }

  return "";
}

export function attachMessageParts(
  messages: Message[],
  getMessageParts: (messageId: number) => MessageWithParts["parts"],
  getQuotedMessage?: (messageId: number) => QuotedMessagePreview | null
): MessageWithParts[] {
  return messages.map((message) => ({
    ...message,
    parts: getMessageParts(message.id),
    quoted_message: message.quoted_message_id && getQuotedMessage
      ? getQuotedMessage(message.quoted_message_id)
      : undefined,
  })) as MessageWithParts[];
}
