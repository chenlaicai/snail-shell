import type { SnailName } from "../persistence/store";
import type { OpenAIClient } from "./openai";
import { logger } from "../logger";

export interface MentionExtractionInput {
  messageText: string;
  participatingSnails: Array<{ name: SnailName }>;
}

export interface MentionExtractionResult {
  mentions: Array<{
    snail: SnailName;
    raw: string;
  }>;
}

export interface MentionExtractor {
  extractMentions(input: MentionExtractionInput): Promise<MentionExtractionResult>;
}

export class OpenAIMentionExtractor implements MentionExtractor {
  constructor(private client: OpenAIClient) {}

  private buildSystemPrompt(): string {
    return [
      "你的任务：从消息中提取所有被呼叫出来干活的对象。",
      "",
      "什么是呼叫：",
      "- 使用 @ 符号：@Owner Snail",
      "- 请求参与：请 Owner Snail 确认",
      "- 指派任务：Owner Snail 你来处理",
      "",
      "什么不是呼叫：",
      "- 自我介绍：我是 Owner Snail",
      "- 陈述事实：Owner Snail 负责...",
      "- 历史回顾：之前 Design Snail 说过...",
      "",
      "输出 JSON 格式：{\"mentions\":[{\"snail\":\"提取的名称\",\"raw\":\"原文片段\"}]}",
      "没有呼叫则输出：{\"mentions\":[]}",
    ].join("\n");
  }

  private parseExtractionResult(content: string, input: MentionExtractionInput): MentionExtractionResult {
    try {
      const parsed = JSON.parse(content) as MentionExtractionResult;
      const validSnailNames = new Set(input.participatingSnails.map((s) => s.name));

      const result = {
        mentions: Array.isArray(parsed.mentions)
          ? parsed.mentions.filter((item): item is { snail: SnailName; raw: string } => {
              if (!item?.snail || !item?.raw) return false;
              // 验证提取的名称是否在 snail 列表中
              return validSnailNames.has(item.snail);
            })
          : [],
      };
      return result;
    } catch (error) {
      logger.warn("Failed to parse mention extraction result", {
        error: error instanceof Error ? error.message : String(error),
        rawContent: content.substring(0, 200),
        contentLength: content.length,
        participatingSnails: input.participatingSnails.map((s) => s.name),
      });
      return { mentions: [] };
    }
  }

  async extractMentions(input: MentionExtractionInput): Promise<MentionExtractionResult> {
    const content = await this.client.createChatCompletion([
      { role: "system", content: this.buildSystemPrompt() },
      {
        role: "user",
        content: `消息文本: ${input.messageText}`,
      },
    ]);

    return this.parseExtractionResult(content, input);
  }
}
