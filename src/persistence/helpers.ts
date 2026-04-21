import type {
  Conversation,
  Message,
  MessagePart,
  MessageRole,
  MessageWithParts,
  Project,
  QuotedMessagePreview,
  RuntimeSessionBinding,
  SnailName,
  Stage,
} from "./types";
import type { ArtifactDefinitionMap, StageDefinitionMap } from "../meta";
import type { SnailDefinitionMap } from "../snails";

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

export function parseJsonObject<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

export function mapProject(row: Record<string, unknown>): Project {
  return {
    ...(row as Omit<Project, "workflow_stage_types" | "workflow_stage_definitions" | "artifact_definitions" | "snail_definitions">),
    workflow_stage_types: parseJsonArray(row.workflow_stage_types as string | null),
    workflow_stage_definitions: parseJsonObject<StageDefinitionMap>(row.workflow_stage_definitions as string | null, {} as StageDefinitionMap),
    artifact_definitions: parseJsonObject<ArtifactDefinitionMap>(row.artifact_definitions as string | null, {} as ArtifactDefinitionMap),
    snail_definitions: parseJsonObject<SnailDefinitionMap>(row.snail_definitions as string | null, {} as SnailDefinitionMap),
  } as Project;
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
