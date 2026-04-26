import type { AgentMessage } from "../agent/interface";
import type { Conversation, MessagePart, MessageWithParts } from "../persistence/store";
import { extractTextFromBlocks, getPrimaryMessageText } from "./message-parts";

export function buildAgentMessages(conversation: Conversation | undefined, history: MessageWithParts[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  const summaryMessage = buildConversationSummaryMessage(conversation);
  if (summaryMessage) {
    messages.push(summaryMessage);
  }

  messages.push(
    ...history
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: buildAgentMessageContent(message),
      }))
  );

  return messages;
}

function buildConversationSummaryMessage(conversation?: Conversation): AgentMessage | null {
  const summary = conversation?.summary?.trim();
  if (!summary) {
    return null;
  }

  return {
    role: "assistant",
    content: `Conversation summary:\n${summary}`,
  };
}

function buildAgentMessageContent(message: MessageWithParts): string {
  if (message.role === "assistant") {
    return `${message.from_snail ?? "Assistant"}:\n${buildAssistantMessageContent(message.parts)}`;
  }

  return `USER:\n${buildUserMessageContent(message.parts)}`;
}

function buildAssistantMessageContent(parts: MessagePart[]): string {
  return getPrimaryMessageText({ parts } as MessageWithParts);
}

function buildUserMessageContent(parts: MessagePart[]): string {
  return parts
    .filter((part) => part.kind === "result")
    .map((part) => resolveResultText(part.payload))
    .filter(Boolean)
    .join("\n\n");
}

function resolveResultText(payload: MessagePart["payload"] | undefined): string {
  if (!payload || !(payload as any).format) {
    return "";
  }
  const resultPayload = payload as any;
  switch (resultPayload.format) {
    case "blocks":
      return resultPayload.fallback_text ?? extractTextFromBlocks(resultPayload.blocks ?? []);
    default:
      return "";
  }
}
