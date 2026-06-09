import type { RoleName } from "../shared/types";
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
    return [
      "从消息中提取所有被明确呼叫出来继续处理工作的角色。",
      "使用 `@` 符号并指向候选角色时视为呼叫；请求候选角色参与、确认、检视、回应或处理时视为呼叫；直接向候选角色指派任务时视为呼叫。",
      "自我介绍、职责说明、历史回顾或普通事实陈述不视为呼叫。如果语义像在呼叫但无法对应到候选列表中的原始 name，则不要输出。",
      "",
      "`role` 字段必须使用候选列表中的原始 name；`raw` 字段保留触发呼叫的原文片段。",
      "有呼叫时只输出 JSON：`{\"mentions\":[{\"role\":\"候选列表中的原始 name\",\"raw\":\"原文片段\"}]}`",
      "没有呼叫时只输出 JSON：`{\"mentions\":[]}`",
      "不要输出 JSON 之外的文本。",
    ].join("\n");
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
