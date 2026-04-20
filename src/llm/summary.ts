import type { ConversationKind, MessageWithParts } from "../persistence/store";
import { joinPartTextByType } from "../project/message-parts";
import type { OpenAIClient } from "./openai";

export interface ConversationSummaryInput {
  conversation: {
    title: string;
    kind: ConversationKind;
  };
  previousSummary: string;
  recentMessages: MessageWithParts[];
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
        content: [
          "你是系统内置的历史对话摘要模块。",
          "你的任务是根据已有摘要和最近消息，生成新的 Markdown 摘要。",
          "输出必须且只能包含以下两个部分:",
          "## 会话概览",
          "## 当前进展",
          "其中 `## 当前进展` 内必须包含两行，以 `当前状态:` 和 `后续动作:` 开头。",
          "摘要必须短，目标长度控制在 220-320 个中文字符内，最多不要超过 400 个中文字符。",
          "`## 会话概览` 最多 2 句，只保留主线目标、稳定约束、已确认决定或关键冲突。",
          "`## 当前进展` 只保留最关键的当前状态和下一步方向，不要展开解释。",
          "不要复述具体 message 原文，不要写流水账，不要输出任何额外解释。",
          "重点保留对后续继续工作仍然有价值的信息，例如目标、约束、已确认决定、未决问题和下一步方向。",
          "如果已有 summary 中存在仍然有效的稳定信息，优先压缩保留，不要每轮重写成长篇总结。",
        ].join("\n"),
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
      const speaker = message.role === "user" ? "用户" : (message.producer_snail ?? message.role);
      const content = joinPartTextByType(message.parts, ["content", "tool_use", "system_event"])
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
