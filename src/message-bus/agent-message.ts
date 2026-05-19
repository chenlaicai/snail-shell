import type { AgentMessage } from "../agent/interface";
import type { Conversation, MessageWithEvents } from "../persistence/store";
import { formatMessageContextForPrompt } from "./message-context";

export function buildAgentMessages(conversation: Conversation | undefined, history: MessageWithEvents[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  const summaryMessage = buildConversationSummaryMessage(conversation);
  if (summaryMessage) messages.push(summaryMessage);
  messages.push(
    ...history
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role as "user" | "assistant", content: buildAgentMessageContent(message) }))
  );
  return messages;
}

function buildConversationSummaryMessage(conversation?: Conversation): AgentMessage | null {
  const summary = conversation?.summary?.trim();
  return summary ? { role: "assistant", content: `Conversation summary:\n${summary}` } : null;
}

function buildAgentMessageContent(message: MessageWithEvents): string {
  const speaker = message.role === "assistant" ? message.from_role ?? "Assistant" : "USER";
  return `${speaker}:\n${formatMessageContextForPrompt(message)}`;
}
