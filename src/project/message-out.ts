import type {
  CreateMessagePartInput,
  QuestionResponseResultPayload,
  QuestionResultPayload,
  ResultPartPayload,
  SnailName,
} from "../persistence/store";
import type { QuestionOptionPayload } from "../persistence/types";
import {
  buildPlainTextResultPart,
  buildQuestionResponseResultPart,
  buildQuestionResultPart,
  buildStructuredTextResultPart,
} from "./message-parts";

interface MentionRecord {
  snail: SnailName;
}

interface MessageOutTextInput {
  content: unknown;
  mentions?: unknown;
}

interface MessageOutQuestionInput {
  title?: unknown;
  question?: unknown;
  reason?: unknown;
  selection_mode?: unknown;
  options?: unknown;
}

interface MessageOutQuestionResponseInput {
  response_to?: unknown;
  selection_mode?: unknown;
  selected_options?: unknown;
  summary?: unknown;
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

function normalizeSelectedOptions(value: unknown): QuestionResponseResultPayload["selected_options"] {
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

export function buildMessageOutText(input: MessageOutTextInput): CreateMessagePartInput<"result", ResultPartPayload> {
  const content = normalizeContent(input.content, "content");
  const mentions = normalizeMentions(input.mentions);
  return mentions ? buildStructuredTextResultPart(content, mentions) : buildPlainTextResultPart(content);
}

export function buildMessageOutQuestion(input: MessageOutQuestionInput): CreateMessagePartInput<"result", QuestionResultPayload> {
  const payload: QuestionResultPayload = {
    format: "question",
    title: normalizeContent(input.title ?? "需要你的确认", "title"),
    question: normalizeContent(input.question, "question"),
    reason: typeof input.reason === "string" && input.reason.trim() ? input.reason : undefined,
    selection_mode: normalizeSelectionMode(input.selection_mode),
    options: normalizeQuestionOptions(input.options),
  };
  return buildQuestionResultPart(payload);
}

export function buildMessageOutQuestionResponse(
  input: MessageOutQuestionResponseInput
): CreateMessagePartInput<"result", QuestionResponseResultPayload> {
  const responseTo = isRecord(input.response_to) ? input.response_to : null;
  const title = responseTo && typeof responseTo.title === "string" && responseTo.title.trim()
    ? responseTo.title
    : null;
  if (!title) {
    throw new Error("response_to.title must be a non-empty string");
  }

  const payload: QuestionResponseResultPayload = {
    format: "question_response",
    response_to: { title },
    selection_mode: normalizeSelectionMode(input.selection_mode),
    selected_options: normalizeSelectedOptions(input.selected_options),
    summary: normalizeContent(input.summary, "summary"),
  };
  return buildQuestionResponseResultPart(payload);
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

  const format = parsed.format;
  switch (format) {
    case "plain_text":
    case "structured_text":
      return buildMessageOutText({ content: parsed.content, mentions: parsed.mentions });
    case "question":
      return buildMessageOutQuestion(parsed);
    case "question_response":
      return buildMessageOutQuestionResponse(parsed);
    default:
      throw new Error("message-out payload format must be one of: plain_text, structured_text, question, question_response");
  }
}

export function stringifyMessageOutPart(part: CreateMessagePartInput<"result", ResultPartPayload>): string {
  return `${JSON.stringify(part.payload, null, 2)}\n`;
}

export function normalizeMentionRecords(mentions: MentionRecord[]): SnailName[] {
  return [...new Set(mentions.map((mention) => mention.snail))];
}
