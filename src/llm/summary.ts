import type { ConversationKind, MessageWithEvents } from "../persistence/store";
import { getTaskPrompt } from "../meta";
import { getPrimaryMessageText } from "../project/message-events";
import type { OpenAIClient } from "./openai";

export interface ConversationSummaryInput {
  conversation: {
    title: string;
    kind: ConversationKind;
  };
  previousSummary: string;
  recentMessages: MessageWithEvents[];
}

export interface ConversationSummaryGenerator {
  generateConversationSummary(input: ConversationSummaryInput): Promise<string>;
}

export class OpenAIConversationSummaryGenerator implements ConversationSummaryGenerator {
  constructor(private client: OpenAIClient) {}

  async generateConversationSummary(input: ConversationSummaryInput): Promise<string> {
    return this.client.createChatCompletion([
      {
        role: "system",
        content: getTaskPrompt("task.conversation-summary.system"),
      },
      {
        role: "user",
        content: buildSummaryPrompt(input),
      },
    ]);
  }
}

function buildSummaryPrompt(input: ConversationSummaryInput): string {
  const recentTranscript = input.recentMessages
    .map((message) => {
      const speaker = message.role === "user" ? "用户" : (message.from_snail ?? message.role);
      const content = getPrimaryMessageText(message)
        .replace(/\s+/g, " ")
        .trim();
      return `- ${speaker}: ${clipText(content, 400) || "(空)"}`;
    })
    .join("\n");

  return [
    `Conversation 标题: ${input.conversation.title}`,
    `Conversation 类型: ${input.conversation.kind}`,
    `已有 summary: ${input.previousSummary || "无"}`,
    "最近消息:",
    recentTranscript || "- 无",
  ].join("\n");
}

function clipText(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}
