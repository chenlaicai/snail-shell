import type { SnailName } from "../persistence/store";
import { getTaskPrompt } from "../meta";
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
    return getTaskPrompt("task.mention-extractor.system");
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
        content: [
          `候选 snails: ${input.participatingSnails.map((item) => item.name).join(", ")}`,
          `消息文本: ${input.messageText}`,
        ].join("\n"),
      },
    ]);

    return this.parseExtractionResult(content, input);
  }
}
