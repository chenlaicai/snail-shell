import { logger } from "../logger";
import type { CreateMessagePartInput, ResultPartPayload, SnailName } from "../persistence/store";
import {
  buildPlainTextResultPart,
  buildQuestionResponseResultPart,
  buildQuestionResultPart,
  buildResultPart,
} from "./message-parts";

export interface AgentMessageObject {
  content: string;
  mentions?: string[];
}

interface AgentQuestionObject {
  type: "question";
  title?: unknown;
  question?: unknown;
  reason?: unknown;
  selection_mode?: unknown;
  options?: unknown;
}

interface AgentQuestionResponseObject {
  type: "question_response";
  response_to?: unknown;
  selection_mode?: unknown;
  selected_options?: unknown;
  summary?: unknown;
}

type StructuredAgentReply = AgentMessageObject | AgentQuestionObject | AgentQuestionResponseObject;

export function parseAgentReply(reply: string, snailName: string): CreateMessagePartInput<"result", ResultPartPayload> {
  const jsonText = extractJSON(reply);

  if (jsonText) {
    const structuredReply = tryParseStructuredReply(jsonText, snailName);
    if (structuredReply) {
      return structuredReply;
    }
  }

  return buildPlainTextResultPart(reply);
}

function tryParseStructuredReply(jsonText: string, snailName: string): CreateMessagePartInput<"result", ResultPartPayload> | null {
  try {
    if (jsonText.trim().startsWith("{")) {
      return parseStructuredObject(jsonText, snailName);
    }

    if (jsonText.trim().startsWith("[")) {
      return parseStructuredArray(jsonText, snailName);
    }
  } catch (err) {
    logger.debug("Agent JSON parse failed", { snail: snailName, error: err instanceof Error ? err.message : String(err) });
  }

  return null;
}

function parseStructuredObject(jsonText: string, snailName: string): CreateMessagePartInput<"result", ResultPartPayload> | null {
  const parsed = JSON.parse(jsonText) as StructuredAgentReply;
  const structuredReply = tryBuildStructuredResultPart(parsed, snailName);
  if (structuredReply) {
    return structuredReply;
  }

  if (!isAgentMessageObject(parsed)) {
    return null;
  }

  logger.debug("Agent returned structured object", { snail: snailName });
  return buildResultPart(parsed.content, parsed.mentions as SnailName[] | undefined);
}

function parseStructuredArray(jsonText: string, snailName: string): CreateMessagePartInput<"result", ResultPartPayload> | null {
  logger.warn("Agent returned structured array reply; flattening to single content", { snail: snailName });
  const parsed = JSON.parse(jsonText) as AgentMessageObject[];
  if (!Array.isArray(parsed) || !parsed.every((obj) => obj.content !== undefined)) {
    return null;
  }

  const mergedContent = parsed
    .map((obj) => String(obj.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  const mergedMentions = [...new Set(parsed.flatMap((obj) => Array.isArray(obj.mentions) ? obj.mentions : []))] as SnailName[];
  return buildResultPart(mergedContent, mergedMentions.length > 0 ? mergedMentions : undefined);
}

function isStructuredPayloadObject(parsed: StructuredAgentReply): parsed is AgentQuestionObject | AgentQuestionResponseObject {
  return Boolean(parsed) && typeof parsed === "object" && "type" in parsed;
}

function isAgentMessageObject(parsed: StructuredAgentReply): parsed is AgentMessageObject {
  return Boolean(parsed) && typeof parsed === "object" && "content" in parsed;
}

function buildQuestionOptions(options: unknown) {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.map(buildQuestionOption);
}

function buildQuestionResponseOptions(selectedOptions: unknown) {
  if (!Array.isArray(selectedOptions)) {
    return [];
  }

  return selectedOptions.map(buildQuestionResponseOption);
}

function buildQuestionOption(option: any) {
  const normalizedKey = String(option?.key ?? "");
  return {
    key: normalizedKey,
    label: readString(option?.label) ?? normalizedKey,
    description: readString(option?.description),
    allow_text_input: option?.allow_text_input === true,
    text_input_label: readString(option?.text_input_label),
    text_input_placeholder: readString(option?.text_input_placeholder),
  };
}

function buildQuestionResponseOption(option: any) {
  const normalizedKey = String(option?.key ?? "");
  return {
    key: normalizedKey,
    label: readString(option?.label) ?? normalizedKey,
    extra_text: readString(option?.extra_text),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function selectJsonCandidate(objectMatch: RegExpMatchArray | null, arrayMatch: RegExpMatchArray | null): string | null {
  if (objectMatch && arrayMatch) {
    return objectMatch.index! < arrayMatch.index! ? objectMatch[0] : arrayMatch[0];
  }

  return objectMatch?.[0] || arrayMatch?.[0] || null;
}

function tryBuildStructuredResultPart(
  parsed: StructuredAgentReply,
  snailName: string
): CreateMessagePartInput<"result", ResultPartPayload> | null {
  if (!isStructuredPayloadObject(parsed)) {
    return null;
  }

  if (parsed.type === "question") {
    return buildQuestionPart(parsed, snailName);
  }

  if (parsed.type === "question_response") {
    return buildQuestionResponsePart(parsed, snailName);
  }

  return null;
}

function buildQuestionPart(parsed: AgentQuestionObject, snailName: string) {
  logger.debug("Agent returned question JSON", { snail: snailName });
  return buildQuestionResultPart({
    format: "question",
    title: typeof parsed.title === "string" ? parsed.title : "需要你的确认",
    question: typeof parsed.question === "string" ? parsed.question : "",
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    selection_mode: parsed.selection_mode === "multiple" ? "multiple" : "single",
    options: buildQuestionOptions(parsed.options),
  });
}

function buildQuestionResponsePart(parsed: AgentQuestionResponseObject, snailName: string) {
  logger.debug("Agent returned question response JSON", { snail: snailName });
  return buildQuestionResponseResultPart({
    format: "question_response",
    response_to: {
      title: typeof (parsed.response_to as any)?.title === "string" ? (parsed.response_to as any).title : "",
    },
    selection_mode: parsed.selection_mode === "multiple" ? "multiple" : "single",
    selected_options: buildQuestionResponseOptions(parsed.selected_options),
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  });
}

function extractJSON(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  return selectJsonCandidate(objectMatch, arrayMatch);
}
