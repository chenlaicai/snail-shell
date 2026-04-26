import { extractTextFromBlocks } from "../project/message-parts";
import type { AgentMessage } from "./interface";
import type { MessagePart, MessageWithParts } from "../persistence/store";

function fullText(text: string): string {
  return text;
}

export function formatText(text: string): string {
  return fullText(text);
}

export function formatAgentMessages(messages: AgentMessage[]): string {
  return fullText(messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n"));
}

export function formatAgentMessagesForPrompt(messages: AgentMessage[]): string {
  return fullText(messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n"));
}

export function formatConversationMessages(messages: MessageWithParts[]): string {
  return fullText(
    messages
      .map((message) => `${message.from_snail ?? message.role}: ${formatMessageParts(message.parts)}`)
      .join("\n\n"),
  );
}

function formatMessageParts(parts: MessagePart[]): string {
  const fragments = parts.flatMap(formatMessagePart).filter(Boolean);
  return fullText(fragments.join("\n\n"));
}

function formatMessagePart(part: MessagePart): string[] {
  if (part.kind === "result") {
    return formatResultPart(part);
  }
  if (part.kind === "delta") {
    return formatDeltaPart(part);
  }
  return [];
}

function formatResultPart(part: Extract<MessagePart, { kind: "result" }>): string[] {
  switch (part.payload.format) {
    case "blocks":
      return [part.payload.fallback_text || extractTextFromBlocks(part.payload.blocks)];
  }
}

function formatDeltaPart(part: Extract<MessagePart, { kind: "delta" }>): string[] {
  switch (part.payload.kind) {
    case "text":
      return [part.payload.text];
    case "tool_result":
    case "mcp_result":
    case "skill_result":
      return [part.payload.output_text ?? part.payload.error_text ?? ""];
    case "error_observation":
      return [part.payload.error_text];
    default:
      return [];
  }
}
