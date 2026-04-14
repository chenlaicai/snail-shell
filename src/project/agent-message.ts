import type { AgentMessage } from "../agent/interface";
import type { Conversation, MessagePart, MessageWithParts } from "../persistence/store";
import { joinPartText, joinPartTextByType } from "./message-parts";

type MessagePartContent = Array<Pick<MessagePart, "part_type" | "text_value" | "ref_value">>;

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
    return `${message.producer_snail ?? "Assistant"}:\n${buildAssistantMessageContent(message.parts)}`;
  }

  return `USER:\n${buildUserMessageContent(message.parts)}`;
}

function buildAssistantMessageContent(parts: MessagePartContent): string {
  const resultParts = parts.filter((part) => part.part_type === "result");
  if (resultParts.length > 0) {
    return joinPartText(resultParts);
  }

  return joinPartTextByType(parts, ["text", "mention", "tool_use", "system_event", "quote"]);
}

function buildUserMessageContent(parts: MessagePartContent): string {
  return joinPartTextByType(parts, ["text", "mention", "quote"]);
}
