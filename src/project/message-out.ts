import type {
  CreateMessagePartInput,
  MessageContentBlock,
  ResultPartPayload,
  SnailName,
} from "../persistence/store";
import type { QuestionOptionPayload } from "../persistence/types";
import {
  buildBlocksResultPart,
  buildPlainTextResultPart,
  buildStructuredTextResultPart,
} from "./message-parts";

interface MentionRecord {
  snail: SnailName;
}

interface MessageOutTextInput {
  content: unknown;
  mentions?: unknown;
}

interface MessageOutBlocksInput {
  blocks?: unknown;
  fallback_text?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeContent(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function normalizeSelectionMode(value: unknown): "single" | "multiple" {
  return value === "multiple" ? "multiple" : "single";
}

function normalizeOptionIdentity(option: Record<string, unknown>, index: number, fieldName: string): { key: string; label: string } {
  const key = typeof option.key === "string" && option.key.trim()
    ? option.key
    : null;
  const label = typeof option.label === "string" && option.label.trim()
    ? option.label
    : null;
  if (!key || !label) {
    throw new Error(`${fieldName}[${index}] must contain non-empty key and label`);
  }
  return { key, label };
}

function normalizeMentions(value: unknown): SnailName[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("mentions must be an array of snail names");
  }

  const mentions = value
    .map((item) => {
      if (typeof item === "string" && item.trim()) {
        return item as SnailName;
      }
      if (isRecord(item) && typeof item.snail === "string" && item.snail.trim()) {
        return item.snail as SnailName;
      }
      throw new Error("mentions must contain snail name strings or { snail } objects");
    });

  return mentions.length > 0 ? [...new Set(mentions)] : undefined;
}

function normalizeQuestionOptions(value: unknown): QuestionOptionPayload[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("options must be a non-empty array");
  }

  return value.map((option, index) => {
    if (!isRecord(option)) {
      throw new Error(`options[${index}] must be an object`);
    }
    const { key, label } = normalizeOptionIdentity(option, index, "options");
    return {
      key,
      label,
      description: typeof option.description === "string" ? option.description : undefined,
      allow_text_input: option.allow_text_input === true,
      text_input_label: typeof option.text_input_label === "string" ? option.text_input_label : undefined,
      text_input_placeholder: typeof option.text_input_placeholder === "string" ? option.text_input_placeholder : undefined,
    };
  });
}

function normalizeSelectedOptions(value: unknown): Array<{ key: string; label: string; extra_text?: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("selected_options must be a non-empty array");
  }

  return value.map((option, index) => {
    if (!isRecord(option)) {
      throw new Error(`selected_options[${index}] must be an object`);
    }
    const { key, label } = normalizeOptionIdentity(option, index, "selected_options");
    return {
      key,
      label,
      extra_text: typeof option.extra_text === "string" ? option.extra_text : undefined,
    };
  });
}

function normalizeBlocks(value: unknown): MessageContentBlock[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("blocks must be a non-empty array");
  }
  return value.map(normalizeBlock);
}

function normalizeBlock(block: unknown, index: number): MessageContentBlock {
  if (!isRecord(block) || typeof block.type !== "string") {
    throw new Error(`blocks[${index}] must be an object with a string type`);
  }
  if (block.type === "text" || block.type === "rich_text" || block.type === "markdown") {
    return {
      type: block.type,
      text: normalizeContent(block.text, `blocks[${index}].text`),
      ...(block.type === "text" && normalizeMentions(block.mentions) ? { mentions: normalizeMentions(block.mentions) } : {}),
    };
  }
  if (block.type === "image") {
    return {
      type: "image",
      url: normalizeContent(block.url, `blocks[${index}].url`),
      alt: typeof block.alt === "string" ? block.alt : undefined,
    };
  }
  if (block.type === "icon") {
    return {
      type: "icon",
      name: normalizeContent(block.name, `blocks[${index}].name`),
      label: typeof block.label === "string" ? block.label : undefined,
    };
  }
  if (block.type === "chart") {
    return normalizeChartBlock(block, index);
  }
  if (block.type === "table") {
    return normalizeTableBlock(block, index);
  }
  if (block.type === "tool_call_card") {
    return normalizeToolCallCardBlock(block, index);
  }
  if (block.type === "artifact_card") {
    return normalizeArtifactCardBlock(block, index);
  }
  if (block.type === "reference_card") {
    return normalizeReferenceCardBlock(block, index);
  }
  if (block.type === "question") {
    return {
      type: "question",
      title: normalizeContent(block.title, `blocks[${index}].title`),
      question: normalizeContent(block.question, `blocks[${index}].question`),
      reason: typeof block.reason === "string" && block.reason.trim() ? block.reason : undefined,
      selection_mode: normalizeSelectionMode(block.selection_mode),
      options: normalizeQuestionOptions(block.options),
    };
  }
  if (block.type === "question_response") {
    const responseTo = isRecord(block.response_to) ? block.response_to : null;
    const title = responseTo && typeof responseTo.title === "string" && responseTo.title.trim()
      ? responseTo.title
      : null;
    if (!title) {
      throw new Error(`blocks[${index}].response_to.title must be a non-empty string`);
    }
    return {
      type: "question_response",
      response_to: { title },
      selection_mode: normalizeSelectionMode(block.selection_mode),
      selected_options: normalizeSelectedOptions(block.selected_options),
      summary: normalizeContent(block.summary, `blocks[${index}].summary`),
    };
  }
  throw new Error(`blocks[${index}] has unsupported type: ${block.type}`);
}

function normalizeTableBlock(block: Record<string, unknown>, index: number): MessageContentBlock {
  if (!Array.isArray(block.columns) || block.columns.some((column) => typeof column !== "string")) {
    throw new Error(`blocks[${index}].columns must be an array of strings`);
  }
  if (!Array.isArray(block.rows) || block.rows.some((row) => !Array.isArray(row))) {
    throw new Error(`blocks[${index}].rows must be a 2D array`);
  }
  return {
    type: "table",
    columns: block.columns,
    rows: block.rows as Array<Array<string | number | boolean | null>>,
    title: typeof block.title === "string" ? block.title : undefined,
  };
}

function normalizeChartBlock(block: Record<string, unknown>, index: number): MessageContentBlock {
  if (!isRecord(block.data)) {
    throw new Error(`blocks[${index}].data must be an object`);
  }
  return {
    type: "chart",
    chart_type: block.chart_type === "line" || block.chart_type === "pie" || block.chart_type === "table" ? block.chart_type : "bar",
    title: typeof block.title === "string" ? block.title : undefined,
    data: block.data,
  };
}

function normalizeToolCallCardBlock(block: Record<string, unknown>, index: number): MessageContentBlock {
  return {
    type: "tool_call_card",
    tool_name: normalizeContent(block.tool_name, `blocks[${index}].tool_name`),
    status: normalizeToolCardStatus(block.status),
    summary: typeof block.summary === "string" ? block.summary : undefined,
    detail: typeof block.detail === "string" ? block.detail : undefined,
  };
}

function normalizeArtifactCardBlock(block: Record<string, unknown>, index: number): MessageContentBlock {
  return {
    type: "artifact_card",
    artifact_id: typeof block.artifact_id === "string" ? block.artifact_id : undefined,
    artifact_type: typeof block.artifact_type === "string" ? block.artifact_type as any : undefined,
    title: normalizeContent(block.title, `blocks[${index}].title`),
    summary: typeof block.summary === "string" ? block.summary : undefined,
    status: typeof block.status === "string" ? block.status : undefined,
  };
}

function normalizeReferenceCardBlock(block: Record<string, unknown>, index: number): MessageContentBlock {
  return {
    type: "reference_card",
    ref_type: block.ref_type === "artifact" || block.ref_type === "conversation" || block.ref_type === "stage" || block.ref_type === "project" || block.ref_type === "external"
      ? block.ref_type
      : "message",
    ref_id: typeof block.ref_id === "string" ? block.ref_id : undefined,
    title: normalizeContent(block.title, `blocks[${index}].title`),
    summary: typeof block.summary === "string" ? block.summary : undefined,
    href: typeof block.href === "string" ? block.href : undefined,
  };
}

function normalizeToolCardStatus(value: unknown): "pending" | "running" | "success" | "error" | undefined {
  return value === "pending" || value === "running" || value === "success" || value === "error"
    ? value
    : undefined;
}

export function extractEmbeddedMessageOutCandidate(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  for (let index = trimmed.indexOf("{"); index !== -1; index = trimmed.indexOf("{", index + 1)) {
    const candidate = trimmed.slice(index).trim();
    if (!candidate.startsWith("{")) continue;
    try {
      parseMessageOutPayload(candidate);
      return candidate;
    } catch {
      // Ignore non-message-out candidates and keep scanning.
    }
  }
  return null;
}

export function buildMessageOutText(input: MessageOutTextInput): CreateMessagePartInput<"result", ResultPartPayload> {
  const content = normalizeContent(input.content, "content");
  const mentions = normalizeMentions(input.mentions);
  return mentions ? buildStructuredTextResultPart(content, mentions) : buildPlainTextResultPart(content);
}

export function buildMessageOutBlocks(
  input: MessageOutBlocksInput,
): CreateMessagePartInput<"result", ResultPartPayload> {
  return buildBlocksResultPart(
    normalizeBlocks(input.blocks),
    typeof input.fallback_text === "string" && input.fallback_text.trim() ? input.fallback_text : undefined,
  );
}

export function parseMessageOutPayload(raw: string): CreateMessagePartInput<"result", ResultPartPayload> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`message-out payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  if (!isRecord(parsed)) {
    throw new Error("message-out payload must be a JSON object");
  }

  if (typeof parsed.format !== "string") {
    throw new Error("message-out payload must contain a string format field");
  }

  if (parsed.format !== "blocks") {
    throw new Error("message-out payload format must be blocks");
  }
  return buildMessageOutBlocks(parsed);
}

export function stringifyMessageOutPart(part: CreateMessagePartInput<"result", ResultPartPayload>): string {
  return `${JSON.stringify(part.payload, null, 2)}\n`;
}

export function normalizeMentionRecords(mentions: MentionRecord[]): SnailName[] {
  return [...new Set(mentions.map((mention) => mention.snail))];
}
