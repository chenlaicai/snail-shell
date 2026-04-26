import type {
  BlocksResultPayload,
  CreateMessagePartInput,
  DeltaPartPayload,
  EndMessagePart,
  MessageContentBlock,
  MessagePart,
  MessageWithParts,
  ResultPartPayload,
  ResultMessagePart,
  SnailName,
} from "../persistence/store";

export function getResultPart(message: MessageWithParts): ResultMessagePart | null {
  return message.parts.find((part): part is ResultMessagePart => part.kind === "result") ?? null;
}

export function getEndPart(message: MessageWithParts): EndMessagePart | null {
  return message.parts.find((part): part is EndMessagePart => part.kind === "end") ?? null;
}

export function buildResultPart(content: string, mentions?: SnailName[]): CreateMessagePartInput<"result", ResultPartPayload> {
  return buildStructuredTextResultPart(content, mentions);
}

export function buildStructuredTextResultPart(content: string, mentions?: SnailName[]): CreateMessagePartInput<"result", ResultPartPayload> {
  return buildBlocksResultPart([{ type: "text", text: content, ...(mentions?.length ? { mentions } : {}) }], content);
}

export function buildUserResultPart(content: string, mentions?: SnailName[]): CreateMessagePartInput<"result"> {
  return buildResultPart(content, mentions);
}

export function buildPlainTextResultPart(content: string): CreateMessagePartInput<"result", ResultPartPayload> {
  return buildBlocksResultPart([{ type: "text", text: content }], content);
}

export function buildBlocksResultPart(
  blocks: MessageContentBlock[],
  fallbackText?: string,
): CreateMessagePartInput<"result", BlocksResultPayload> {
  return {
    kind: "result",
    payload: {
      format: "blocks",
      blocks,
      ...(fallbackText ? { fallback_text: fallbackText } : {}),
    },
  };
}

export function extractTextFromBlocks(blocks: MessageContentBlock[]): string {
  return blocks
    .map(extractTextFromBlock)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractTextFromBlock(block: MessageContentBlock): string {
  switch (block.type) {
    case "text":
    case "rich_text":
    case "markdown":
      return block.text;
    case "image":
      return block.alt || "";
    case "icon":
      return block.label || block.name;
    case "chart":
      return block.title || "";
    case "table":
      return [block.title || "", block.columns.join(" ")].filter(Boolean).join("\n");
    case "tool_call_card":
      return block.summary || block.detail || block.tool_name;
    case "artifact_card":
      return [block.title, block.summary || ""].filter(Boolean).join("\n");
    case "reference_card":
      return [block.title, block.summary || ""].filter(Boolean).join("\n");
    default:
      return "";
  }
}

export function buildQuestionResultPart(payload: {
  title: string;
  question: string;
  reason?: string;
  selection_mode: "single" | "multiple";
  options: Array<{
    key: string;
    label: string;
    description?: string;
    allow_text_input?: boolean;
    text_input_label?: string;
    text_input_placeholder?: string;
  }>;
}): CreateMessagePartInput<"result", ResultPartPayload> {
  return buildBlocksResultPart([
    {
      type: "question",
      title: payload.title,
      question: payload.question,
      reason: payload.reason,
      selection_mode: payload.selection_mode,
      options: payload.options,
    },
  ], `${payload.title}\n${payload.question}`);
}

export function buildQuestionResponseResultPart(payload: {
  response_to: { title: string };
  selection_mode: "single" | "multiple";
  selected_options: Array<{
    key: string;
    label: string;
    extra_text?: string;
  }>;
  summary: string;
}): CreateMessagePartInput<"result", ResultPartPayload> {
  return buildBlocksResultPart([
    {
      type: "question_response",
      response_to: payload.response_to,
      selection_mode: payload.selection_mode,
      selected_options: payload.selected_options,
      summary: payload.summary,
    },
  ], payload.summary);
}

export function getResultContent(message: MessageWithParts | { parts: MessagePart[] }): string {
  const part = message.parts.find((item): item is ResultMessagePart => item.kind === "result");
  if (!part) return "";
  switch (part.payload.format) {
    case "blocks":
      return part.payload.fallback_text || extractTextFromBlocks(part.payload.blocks);
  }
}

export function getResultContentFromInputs(parts: CreateMessagePartInput[]): string {
  const part = parts.find((item): item is CreateMessagePartInput<"result", ResultPartPayload> => item.kind === "result");
  if (!part) return "";
  switch (part.payload.format) {
    case "blocks":
      return part.payload.fallback_text || extractTextFromBlocks(part.payload.blocks);
  }
}

export function extractResultMentionsFromInputs(parts: CreateMessagePartInput[]): SnailName[] {
  const part = parts.find((item): item is CreateMessagePartInput<"result", ResultPartPayload> => item.kind === "result");
  return part?.payload.format === "blocks"
    ? part.payload.blocks.flatMap((block) => block.type === "text" && Array.isArray(block.mentions) ? block.mentions : [])
    : [];
}

export function extractResultMentions(message: MessageWithParts | { parts: MessagePart[] }): SnailName[] {
  const part = message.parts.find((item): item is ResultMessagePart => item.kind === "result");
  return part?.payload.format === "blocks"
    ? part.payload.blocks.flatMap((block) => block.type === "text" && Array.isArray(block.mentions) ? block.mentions : [])
    : [];
}

export function buildMessagePreview(message: MessageWithParts, maxLength = 160): string {
  const resultContent = getResultContent(message);
  const fallbackError = collectDeltaErrors(message.parts).join(" ");
  return (resultContent || fallbackError)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function joinPartTextByType(_parts: MessagePart[], _allowedTypes: string[]): string {
  throw new Error("joinPartTextByType is no longer supported under the unified message model");
}

export function collectDeltaTexts(parts: MessagePart[]): string[] {
  return parts
    .filter((part): part is MessagePart & { kind: "delta"; payload: DeltaPartPayload } => part.kind === "delta")
    .flatMap((part) => part.payload.kind === "text" ? [part.payload.text] : []);
}

export function buildTextDeltaPart(text: string): CreateMessagePartInput<"delta"> {
  return {
    kind: "delta",
    payload: {
      kind: "text",
      text,
    },
  };
}

export function buildErrorObservationDeltaPart(
  errorText: string,
  source: "runtime" | "tool" | "mcp" | "system"
): CreateMessagePartInput<"delta"> {
  return {
    kind: "delta",
    payload: {
      kind: "error_observation",
      source,
      error_text: errorText,
    },
  };
}

export function collectDeltaErrors(parts: MessagePart[]): string[] {
  return parts
    .filter((part): part is MessagePart & { kind: "delta"; payload: DeltaPartPayload } => part.kind === "delta")
    .flatMap((part) => {
      switch (part.payload.kind) {
        case "error_observation":
          return [part.payload.error_text];
        case "tool_result":
        case "mcp_result":
        case "skill_result":
          return part.payload.is_error && part.payload.error_text ? [part.payload.error_text] : [];
        default:
          return [];
      }
    });
}

export function getPrimaryMessageText(message: MessageWithParts): string {
  const resultText = getResultContent(message).trim();
  if (resultText) {
    return resultText;
  }
  const errorText = collectDeltaErrors(message.parts).join("\n\n").trim();
  if (errorText) {
    return errorText;
  }
  return collectDeltaTexts(message.parts).join("\n\n").trim();
}
