import type {
  CreateMessageEventInput,
  MessageContentBlock,
  MessageEvent,
  MessageWithEvents,
  RoleName,
} from "../shared/types";
import { extractTextFromBlocks, extractEventText } from "../shared/index";

export type MessageInputEvent = CreateMessageEventInput & { kind: "text" | "content_block" };

export function buildTextEvent(text: string, mentions: RoleName[] = []): MessageInputEvent {
  return { kind: "text", payload: { text, mentions } };
}

export function buildPlainTextEvent(text: string): MessageInputEvent {
  return buildTextEvent(text, []);
}

export function buildContentBlockEvent(blocks: MessageContentBlock[], fallbackText?: string | null): MessageInputEvent {
  return {
    kind: "content_block",
    payload: {
      blocks,
      fallback_text: fallbackText ?? (extractTextFromBlocks(blocks) || null),
    },
  };
}

export function buildStructuredTextEvent(content: string, mentions: RoleName[] = []): MessageInputEvent {
  return buildTextEvent(content, mentions);
}

export function buildQuestionEvent(payload: {
  title: string;
  question: string;
  reason?: string | null;
  selection_mode: "single" | "multiple";
  options: Array<{
    key: string;
    label: string;
    description?: string | null;
    allow_text_input?: boolean;
    text_input_label?: string | null;
    text_input_placeholder?: string | null;
  }>;
}): MessageInputEvent {
  return buildContentBlockEvent([
    {
      type: "question",
      title: payload.title,
      question: payload.question,
      reason: payload.reason ?? null,
      selection_mode: payload.selection_mode,
      options: payload.options.map((option) => ({
        key: option.key,
        label: option.label,
        description: option.description ?? null,
        allow_text_input: option.allow_text_input === true,
        text_input_label: option.text_input_label ?? null,
        text_input_placeholder: option.text_input_placeholder ?? null,
      })),
    },
  ], `${payload.title}\n${payload.question}`);
}

export function buildQuestionResponseEvent(payload: {
  response_to: { title: string };
  selection_mode: "single" | "multiple";
  selected_options: Array<{ key: string; label: string; extra_text?: string | null }>;
  summary: string;
}): MessageInputEvent {
  return buildContentBlockEvent([
    {
      type: "question_response",
      response_to: payload.response_to,
      selection_mode: payload.selection_mode,
      selected_options: payload.selected_options.map((option) => ({ key: option.key, label: option.label, extra_text: option.extra_text ?? null })),
      summary: payload.summary,
    },
  ], payload.summary);
}

export { extractTextFromBlocks } from "../shared/index";

export function getInputContent(events: MessageInputEvent[]): string {
  return events.map((event) => getEventContent(event)).filter(Boolean).join("\n\n").trim();
}

export function extractMentionsFromInputs(events: MessageInputEvent[]): RoleName[] {
  return [...new Set(events.flatMap((event) => extractMentionsFromEvent(event)))];
}

export function extractMessageMentions(message: MessageWithEvents | { events: MessageEvent[] }): RoleName[] {
  return [...new Set(message.events.flatMap((event) => extractMentionsFromEvent(event)))];
}

export function buildMessagePreview(message: MessageWithEvents, maxLength = 160): string {
  return renderMessageEventsForDisplay(message).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function renderMessageEventsForDisplay(message: MessageWithEvents | { events: MessageEvent[] }): string {
  return message.events.map(renderMessageEvent).filter(Boolean).join("\n").trim();
}

export function renderMessageEventsForPrompt(message: MessageWithEvents | { events: MessageEvent[] }): string {
  return message.events.map(renderMessageEvent).filter(Boolean).join("\n").trim();
}

function renderMessageEvent(event: MessageEvent): string {
  const renderer = messageEventRenderers[event.kind] as ((value: MessageEvent) => string) | undefined;
  return renderer ? renderer(event) : "";
}

const messageEventRenderers: Record<MessageEvent["kind"], (event: any) => string> = {
  start: (event) => `[start role=${event.payload.role ?? "unknown"} role_name=${event.payload.role_name ?? "none"} runtime=${event.payload.runtime ?? "unknown"}]`,
  text: (event) => `[text]\n${event.payload.text}`,
  content_block: (event) => `[content_block]\n${event.payload.fallback_text ?? extractTextFromBlocks(event.payload.blocks)}`,
  tool_call: (event) => `[tool_call ${event.payload.tool_name}]\n${safeJson(event.payload.input)}`,
  tool_result: (event) => `[tool_result ${event.payload.tool_name} ${event.payload.is_error ? "error" : "ok"}]\n${event.payload.error_text ?? event.payload.output_text ?? ""}`.trim(),
  command: (event) => `[command]\n${event.payload.command}`,
  command_result: (event) => `[command_result ${event.payload.is_error ? "error" : "ok"}]\n${event.payload.output_text ?? ""}`.trim(),
  signal: (event) => `[signal ${event.payload.type}${event.payload.reason ? `: ${event.payload.reason}` : ""}]`,
  error: (event) => `[error ${event.payload.source}]\n${event.payload.message}`,
};

export function getInputContentFromEvents(events: MessageInputEvent[]): string {
  return getInputContent(events);
}

function getEventContent(event: MessageEvent | MessageInputEvent): string {
  return extractEventText(event);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function extractMentionsFromEvent(event: MessageEvent | MessageInputEvent): RoleName[] {
  if (event.kind === "text") return event.payload.mentions ?? [];
  if (event.kind === "content_block") {
    return event.payload.blocks.flatMap((block) => {
      if (block.type === "text" || block.type === "markdown") return block.mentions ?? [];
      return [];
    });
  }
  return [];
}
