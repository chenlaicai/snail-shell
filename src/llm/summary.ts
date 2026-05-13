import type { ConversationKind, MessageWithEvents } from "../shared/types";
import { getTaskPrompt } from "../meta";
import { formatMessageContextForPrompt } from "../shared/message-context-utils";
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

export interface MessageContextSummaryInput {
  context: string;
  targetChars: number;
}

export interface MessageContextSummaryGenerator {
  generateMessageContextSummary(input: MessageContextSummaryInput): Promise<string>;
}

export class OpenAIConversationSummaryGenerator implements ConversationSummaryGenerator, MessageContextSummaryGenerator {
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

  async generateMessageContextSummary(input: MessageContextSummaryInput): Promise<string> {
    return this.client.createChatCompletion([
      {
        role: "system",
        content: "你负责把单条 Snail Shell 消息压缩成可放入后续 agent 上下文的中文摘要。保留用户指令、结论、失败原因、关键文件/命令/产物引用；删除冗余日志、重复文本和无关过程。只输出摘要正文。",
      },
      {
        role: "user",
        content: [
          `目标长度：不超过 ${input.targetChars} 个中文字符或等价长度。`,
          "原始上下文：",
          input.context,
        ].join("\n"),
      },
    ]);
  }
}

function buildSummaryPrompt(input: ConversationSummaryInput): string {
  const recentTranscript = input.recentMessages
    .map((message) => {
      const speaker = message.role === "user" ? "用户" : (message.from_snail ?? message.role);
      const content = formatMessageContextForPrompt(message)
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
