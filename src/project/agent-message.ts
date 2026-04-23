import type { AgentMessage } from "../agent/interface";
import type { Conversation, MessagePart, MessageWithParts } from "../persistence/store";

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
  const deltas = parts
    .filter((part) => part.kind === "delta")
    .flatMap((part) => {
      switch (part.payload.kind) {
        case "tool_result":
        case "mcp_result":
        case "skill_result":
          return [part.payload.output_text ?? part.payload.error_text ?? ""];
        case "error_observation":
          return [part.payload.error_text];
        default:
          return [];
      }
    })
    .filter(Boolean)
    .join("\n\n");

  const result = resolveResultText(parts.find((part) => part.kind === "result")?.payload);
  return [result, deltas].filter(Boolean).join("\n\n");
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
  switch ((payload as any).format) {
    case "plain_text":
    case "structured_text":
      return (payload as any).content ?? "";
    case "question":
      return (payload as any).question ?? "";
    case "question_response":
      return (payload as any).summary ?? "";
    default:
      return "";
  }
}
