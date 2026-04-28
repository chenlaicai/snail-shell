import type { AgentMessage } from "./interface";
import type { MessageWithEvents } from "../persistence/store";
import { renderMessageEventsForPrompt } from "../project/message-events";

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

export function formatConversationMessages(messages: MessageWithEvents[]): string {
  return fullText(messages.map((message) => `${message.from_snail ?? message.role}:\n${renderMessageEventsForPrompt(message)}`).join("\n\n"));
}
