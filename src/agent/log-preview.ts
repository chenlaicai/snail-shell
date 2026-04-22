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
  const fragments = parts.flatMap((part) => {
    switch (part.kind) {
      case "result":
        return [part.payload.content];
      case "delta":
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
      default:
        return [];
    }
  }).filter(Boolean);
  return fullText(fragments.join("\n\n"));
}
