import type {
  CreateMessagePartInput,
  DeltaPartPayload,
  EndMessagePart,
  MessagePart,
  MessageWithParts,
  QuestionResponseResultPayload,
  QuestionResultPayload,
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
  return {
    kind: "result",
    payload: {
      format: "structured_text",
      content,
      mentions,
    },
  };
}

export function buildUserResultPart(content: string, mentions?: SnailName[]): CreateMessagePartInput<"result"> {
  return buildResultPart(content, mentions);
}

export function buildPlainTextResultPart(content: string): CreateMessagePartInput<"result", ResultPartPayload> {
  return {
    kind: "result",
    payload: {
      format: "plain_text",
      content,
    },
  };
}

export function buildQuestionResultPart(payload: QuestionResultPayload): CreateMessagePartInput<"result", QuestionResultPayload> {
  return {
    kind: "result",
    payload,
  };
}

export function buildQuestionResponseResultPart(payload: QuestionResponseResultPayload): CreateMessagePartInput<"result", QuestionResponseResultPayload> {
  return {
    kind: "result",
    payload,
  };
}

export function getResultContent(message: MessageWithParts | { parts: MessagePart[] }): string {
  const part = message.parts.find((item): item is ResultMessagePart => item.kind === "result");
  if (!part) return "";
  switch (part.payload.format) {
    case "plain_text":
    case "structured_text":
      return part.payload.content;
    case "question":
      return part.payload.question;
    case "question_response":
      return part.payload.summary;
  }
}

export function getResultContentFromInputs(parts: CreateMessagePartInput[]): string {
  const part = parts.find((item): item is CreateMessagePartInput<"result", ResultPartPayload> => item.kind === "result");
  if (!part) return "";
  switch (part.payload.format) {
    case "plain_text":
    case "structured_text":
      return part.payload.content;
    case "question":
      return part.payload.question;
    case "question_response":
      return part.payload.summary;
  }
}

export function extractResultMentionsFromInputs(parts: CreateMessagePartInput[]): SnailName[] {
  const part = parts.find((item): item is CreateMessagePartInput<"result", ResultPartPayload> => item.kind === "result");
  return part?.payload.format === "structured_text" && Array.isArray(part.payload.mentions) ? part.payload.mentions : [];
}

export function extractResultMentions(message: MessageWithParts | { parts: MessagePart[] }): SnailName[] {
  const part = message.parts.find((item): item is ResultMessagePart => item.kind === "result");
  return part?.payload.format === "structured_text" && Array.isArray(part.payload.mentions) ? part.payload.mentions : [];
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
