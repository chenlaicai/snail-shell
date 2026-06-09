import type { ConversationKind, MessageWithEvents, MessageContextSummaryInput, MessageContextSummaryGenerator } from "../shared/types";
import { formatMessageContextForPrompt } from "../shared/message-context-utils";
import type { OpenAIClient } from "./openai";

export type { MessageContextSummaryInput, MessageContextSummaryGenerator };

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

export class OpenAIConversationSummaryGenerator implements ConversationSummaryGenerator, MessageContextSummaryGenerator {
  constructor(private client: OpenAIClient) {}

  async generateConversationSummary(input: ConversationSummaryInput): Promise<string> {
    return this.client.createChatCompletion([
      {
        role: "system",
        content: [
          "优先保留后续仍有价值的信息：目标、约束、已确认决定、关键冲突、未决问题和下一步方向。",
          "如果已有 summary 中存在仍然有效的稳定信息，优先压缩保留。",
          "`## 会话概览` 最多 2 句，只保留主线目标、稳定约束、已确认决定或关键冲突。",
          "`## 当前进展` 只保留最关键的当前状态和下一步方向，不展开解释。",
          "",
          "不要复述具体 message 原文。不要写流水账。不要每轮重写成长篇总结。不要输出额外解释。",
          "",
          "输出必须且只能包含两个二级标题：`## 会话概览` 和 `## 当前进展`。",
          "`## 当前进展` 内必须包含两行，分别以 `当前状态:` 和 `后续动作:` 开头。",
          "摘要目标长度 220-320 个中文字符，最多不超过 400 个。",
        ].join("\n"),
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
      const speaker = message.role === "user" ? "用户" : (message.from_role ?? message.role);
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
