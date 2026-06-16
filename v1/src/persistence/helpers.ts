import type { Workspace } from "../shared/domain-types";
import type {
  ContentBlockEventPayload,
  Conversation,
  ErrorEventPayload,
  Issue,
  Message,
  MessageContext,
  MessageContentBlock,
  MessageEvent,
  SopSnapshot,
  MessageEventCategory,
  MessageEventKind,
  MessageEventPayload,
  MessageEventSource,
  MessageRole,
  MessageRuntime,
  MessageWithEvents,
  PersistedMessageEventRow,
  RoleName,
  Stage,
  StageGateEvidence,
  TextEventPayload,
  ToolResultEventPayload,
  CommandResultEventPayload,
} from "./types";

export function parseJsonArray<T extends string>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function mapStage(row: Record<string, unknown>): Stage {
  const { input_artifacts: _ignoredInputArtifacts, ...stageRow } = row;
  return {
    ...(stageRow as Omit<Stage, "output_artifacts" | "gate_evidence">),
    output_artifacts: parseJsonRecord(row.output_artifacts as string | null),
    gate_evidence: parseGateEvidence(row.gate_evidence as string | null),
  };
}

function parseGateEvidence(value: string | null): StageGateEvidence | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as StageGateEvidence;
    }
    return null;
  } catch {
    return null;
  }
}

export function mapWorkspace(row: Record<string, unknown>): Workspace {
  return {
    ...(row as Omit<Workspace, "guard_profile">),
    guard_profile: parseGuardProfile(row.guard_profile as string | null),
  };
}

function parseGuardProfile(value: string | null): Record<string, unknown> | null {
  if (!value || value === "null") return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function mapIssue(row: Record<string, unknown>): Issue {
  return {
    ...(row as Omit<Issue, "sop_snapshot" | "role_snail_mapping">),
    sop_snapshot: parseSopSnapshot(row.sop_snapshot as string | null),
    role_snail_mapping: parseRoleSnailMapping(row.role_snail_mapping as string | null),
  };
}

function parseSopSnapshot(value: string | null): SopSnapshot {
  if (!value) return { sop_id: "", source: "platform", source_ref: null, name: "", description: null, first_stage: null, shared_handbook: null, stage_definitions: [], transitions: [] };
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) return { sop_id: "", source: "platform", source_ref: null, name: "", description: null, first_stage: null, shared_handbook: null, stage_definitions: [], transitions: [] };
    return parsed as SopSnapshot;
  } catch {
    return { sop_id: "", source: "platform", source_ref: null, name: "", description: null, first_stage: null, shared_handbook: null, stage_definitions: [], transitions: [] };
  }
}

function parseRoleSnailMapping(value: string | null): Record<string, Record<string, string>> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) return {};
    const result: Record<string, Record<string, string>> = {};
    for (const [stageType, roleMap] of Object.entries(parsed)) {
      if (typeof roleMap === "object" && roleMap !== null && !Array.isArray(roleMap)) {
        result[stageType] = {};
        for (const [roleName, templateId] of Object.entries(roleMap as Record<string, unknown>)) {
          result[stageType][roleName] = String(templateId);
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    ...(row as Omit<Conversation, "participating_roles" | "from_conversation_ids">),
    participating_roles: parseJsonArray<RoleName>(row.participating_roles as string | null),
    from_conversation_ids: parseJsonArray<string>(row.from_conversation_ids as string | null),
  };
}

export function mapMessage(row: Record<string, unknown>): Message {
  return {
    ...(row as Omit<Message, "to_roles" | "runtime">),
    to_roles: parseJsonArray<RoleName>(row.to_roles as string | null),
    runtime: row.runtime as MessageRuntime | null,
  };
}

export function mapMessageContext(row: Record<string, unknown>): MessageContext {
  return row as unknown as MessageContext;
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
