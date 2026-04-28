import type {
  ContentBlockEventPayload,
  CreateMessageEventInput,
  MessageContentBlock,
  MessageEvent,
  MessageWithEvents,
  SnailName,
} from "../persistence/store";

export type MessageInputEvent = CreateMessageEventInput & { kind: "text" | "content_block" };

export function buildTextEvent(text: string, mentions: SnailName[] = []): MessageInputEvent {
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

export function buildStructuredTextEvent(content: string, mentions: SnailName[] = []): MessageInputEvent {
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

export function extractTextFromBlocks(blocks: MessageContentBlock[]): string {
  return blocks.map(extractTextFromBlock).filter(Boolean).join("\n\n").trim();
}

function extractTextFromBlock(block: MessageContentBlock): string {
  const extractor = blockTextExtractors[block.type] as ((value: MessageContentBlock) => string) | undefined;
  return extractor ? extractor(block) : "";
}

const blockTextExtractors: Record<MessageContentBlock["type"], (block: any) => string> = {
  text: (block) => block.text,
  rich_text: (block) => block.text,
  markdown: (block) => block.text,
  question: (block) => [block.title, block.question, block.reason ?? ""].filter(Boolean).join("\n"),
  question_response: (block) => block.summary,
  image: (block) => block.alt ?? "",
  icon: (block) => block.label ?? block.name,
  chart: (block) => block.title ?? "",
  table: (block) => [block.title ?? "", block.columns.join(" ")].filter(Boolean).join("\n"),
  tool_call_card: (block) => block.summary ?? block.detail ?? block.tool_name,
  artifact_card: (block) => [block.title, block.summary ?? ""].filter(Boolean).join("\n"),
  reference_card: (block) => [block.title, block.summary ?? ""].filter(Boolean).join("\n"),
};

export function getInputContent(events: MessageInputEvent[]): string {
  return events.map((event) => getEventContent(event)).filter(Boolean).join("\n\n").trim();
}

export function extractMentionsFromInputs(events: MessageInputEvent[]): SnailName[] {
  return [...new Set(events.flatMap((event) => extractMentionsFromEvent(event)))];
}

export function extractMessageMentions(message: MessageWithEvents | { events: MessageEvent[] }): SnailName[] {
  return [...new Set(message.events.flatMap((event) => extractMentionsFromEvent(event)))];
}

export function buildMessagePreview(message: MessageWithEvents, maxLength = 160): string {
  return getPrimaryMessageText(message).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function getPrimaryMessageText(message: MessageWithEvents | { events: MessageEvent[] }): string {
  const text = message.events.flatMap((event) => event.kind === "text" ? [(event.payload as { text: string }).text] : []).filter(Boolean).join("\n\n").trim();
  if (text) return text;
  const blockText = message.events.flatMap((event) => event.kind === "content_block" ? [getContentBlockText(event.payload as ContentBlockEventPayload)] : []).filter(Boolean).join("\n\n").trim();
  if (blockText) return blockText;
  const errors = message.events.flatMap((event) => event.kind === "error" ? [(event.payload as { message: string }).message] : []).filter(Boolean).join("\n\n").trim();
  if (errors) return errors;
  const toolSummaries = message.events.flatMap((event) => {
    if (event.kind === "tool_result" || event.kind === "command_result") {
      const payload = event.payload as { output_text?: string | null; error_text?: string | null };
      return [payload.error_text ?? payload.output_text ?? ""];
    }
    return [];
  }).filter(Boolean).join("\n\n").trim();
  return toolSummaries;
}

export function getInputContentFromEvents(events: MessageInputEvent[]): string {
  return getInputContent(events);
}

function getEventContent(event: MessageEvent | MessageInputEvent): string {
  if (event.kind === "text") return event.payload.text;
  if (event.kind === "content_block") return getContentBlockText(event.payload);
  return "";
}

function getContentBlockText(payload: ContentBlockEventPayload): string {
  return payload.fallback_text ?? extractTextFromBlocks(payload.blocks);
}

function extractMentionsFromEvent(event: MessageEvent | MessageInputEvent): SnailName[] {
  if (event.kind === "text") return event.payload.mentions ?? [];
  if (event.kind === "content_block") {
    return event.payload.blocks.flatMap((block) => {
      if (block.type === "text" || block.type === "markdown") return block.mentions ?? [];
      return [];
    });
  }
  return [];
}
