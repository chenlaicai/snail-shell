import type { AgentMessage } from "../agent/interface";
import type { Conversation, MessagePartType, MessageWithParts } from "../persistence/store";

type MessagePartContent = Array<{ part_type: MessagePartType; content: string }>;

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
    return `${message.snail_name ?? "Assistant"}:\n${buildAssistantMessageContent(message.parts)}`;
  }

  return `USER:\n${buildUserMessageContent(message.parts)}`;
}

function buildAssistantMessageContent(parts: MessagePartContent): string {
  const resultParts = parts.filter((part) => part.part_type === "result");
  if (resultParts.length > 0) {
    return resultParts.map((part) => part.content).join("\n\n");
  }

  return parts
    .filter((part) => part.part_type !== "result")
    .map((part) => part.content)
    .join("\n\n");
}

function buildUserMessageContent(parts: MessagePartContent): string {
  return parts
    .filter((part) => part.part_type === "text")
    .map((part) => part.content)
    .join("\n\n");
}
