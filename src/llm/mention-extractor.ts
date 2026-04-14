import type { SnailName } from "../persistence/store";
import type { OpenAIClient } from "./openai";
import { logger } from "../logger";

export interface MentionExtractionInput {
  messageText: string;
  participatingSnails: Array<{ name: SnailName; title: string }>;
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

  async extractMentions(input: MentionExtractionInput): Promise<MentionExtractionResult> {
    const content = await this.client.createChatCompletion([
      {
        role: "system",
        content: [
          "你是系统内置的 mention 提取模块。",
          "你的任务是从消息文本中提取被提及的 snail。",
          "只能从给定的参与 snail 列表中选择，不允许虚构新的 snail。",
          "输出必须是 JSON，格式为 {\"mentions\":[{\"snail\":\"...\",\"raw\":\"...\"}]}。",
          "如果没有明确 mention，则输出 {\"mentions\":[]}。",
          "不要输出任何 JSON 之外的文本。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `参与 snails: ${input.participatingSnails.map((item) => `${item.name}:${item.title}`).join(", ")}`,
          `消息文本: ${input.messageText}`,
        ].join("\n"),
      },
    ]);

    try {
      const parsed = JSON.parse(content) as MentionExtractionResult;
      return {
        mentions: Array.isArray(parsed.mentions)
          ? parsed.mentions.filter((item): item is { snail: SnailName; raw: string } => Boolean(item?.snail && item?.raw))
          : [],
      };
    } catch (error) {
      logger.warn("Failed to parse mention extraction result", {
        error: error instanceof Error ? error.message : String(error),
        contentLength: content.length,
        participatingSnails: input.participatingSnails.map((s) => s.name),
      });
      return { mentions: [] };
    }
  }
}
