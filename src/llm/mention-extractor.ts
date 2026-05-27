import type { RoleName } from "../shared/types";
import { getPrompt, renderPromptContent } from "../prompt-center";
import type { OpenAIClient } from "./openai";
import { logger } from "../logger";

export interface MentionExtractionInput {
  messageText: string;
  participatingRoles: Array<{ name: RoleName }>;
}

export interface MentionExtractionResult {
  mentions: Array<{
    role: RoleName;
    raw: string;
  }>;
}

export interface MentionExtractor {
  extractMentions(input: MentionExtractionInput): Promise<MentionExtractionResult>;
}

export class OpenAIMentionExtractor implements MentionExtractor {
  constructor(private client: OpenAIClient) {}

  private buildSystemPrompt(): string {
    return renderPromptContent(getPrompt("S-05"), {});
  }

  private parseExtractionResult(content: string, input: MentionExtractionInput): MentionExtractionResult {
    try {
      const parsed = JSON.parse(content) as MentionExtractionResult;
      const validRoleNames = new Set(input.participatingRoles.map((role) => role.name));

      const result = {
        mentions: Array.isArray(parsed.mentions)
          ? parsed.mentions.filter((item): item is { role: RoleName; raw: string } => {
              if (!item?.role || !item?.raw) return false;
              return validRoleNames.has(item.role);
            })
          : [],
      };
      return result;
    } catch (error) {
      logger.warn("Failed to parse mention extraction result", {
        error: error instanceof Error ? error.message : String(error),
        rawContent: content.substring(0, 200),
        contentLength: content.length,
        participatingRoles: input.participatingRoles.map((role) => role.name),
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
          `候选 roles: ${input.participatingRoles.map((item) => item.name).join(", ")}`,
          `消息文本: ${input.messageText}`,
        ].join("\n"),
      },
    ]);

    return this.parseExtractionResult(content, input);
  }
}
