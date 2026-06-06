import type { AgentMessage } from "./interface";
import type { MessageWithEvents } from "../shared/types";
import { formatMessageContextForPrompt } from "../shared/message-context-utils";

export function formatText(text: string): string {
  return text;
}

export function formatAgentMessages(messages: AgentMessage[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

export function formatAgentMessagesForPrompt(messages: AgentMessage[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
}

export function formatConversationMessages(messages: MessageWithEvents[]): string {
  return messages.map((message) => `${message.from_role ?? message.role}:\n${formatMessageContextForPrompt(message)}`).join("\n\n");
}
