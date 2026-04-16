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
      "你是系统内置的 mention 提取模块。",
      "你的任务是从消息文本中提取**明确呼叫、指派或请求参与**的 snail。",
      "",
      "Mention 的定义：",
      "- 明确使用 @ 符号呼叫某个 snail，且 @ 后面必须是该 snail 的唯一 name（如：@Owner Snail、@Product Snail）",
      "- 明确请求某个 snail 参与或处理，且文本中使用的是该 snail 的唯一 name（如：请 Owner Snail 确认、让 Design Snail 看看）",
      "- 明确指派任务给某个 snail，且文本中使用的是该 snail 的唯一 name（如：Owner Snail 你来判断、交给 Implementation Snail）",
      "- 只允许把参与 snail 列表中的 name 当作有效标识；系统逻辑与自然语言中的唯一标识都是 snail name",
      "",
      "以下情况**不是** mention，必须忽略：",
      "- 使用别名、中文角色称呼、模糊角色描述或任何不等于 snail name 的称呼（如：@产品 snail、产品负责人、设计同学）",
      "- 自我介绍或身份说明（如：我是 Owner Snail、我作为 Product Snail）",
      "- 描述性引用（如：Owner Snail 负责...、根据 Product Snail 的职责...）",
      "- 历史回顾（如：之前 Design Snail 说过...、Implementation Snail 已经完成了...）",
      "- 一般性讨论（如：Owner Snail 这个角色...、Product Snail 的工作是...）",
      "- 角色说明（如：作为 Owner Snail、Owner Snail 视角）",
      "",
      "判断标准：",
      "- 如果去掉 snail 名字后，句子变成了对某人的呼叫或指派，那就是 mention",
      "- 如果去掉 snail 名字后，句子只是在陈述事实或介绍，那就不是 mention",
      "",
      "只能从给定的参与 snail 列表中选择，不允许虚构新的 snail。",
      "输出必须是 JSON，格式为 {\"mentions\":[{\"snail\":\"...\",\"raw\":\"...\"}]}。",
      "如果没有明确的呼叫/指派意图，则输出 {\"mentions\":[]}。",
      "不要输出任何 JSON 之外的文本。",
    ].join("\n");
  }

  private parseExtractionResult(content: string, input: MentionExtractionInput): MentionExtractionResult {
    logger.debug("[MentionExtractor] Raw LLM output", { content });
    try {
      const parsed = JSON.parse(content) as MentionExtractionResult;
      const result = {
        mentions: Array.isArray(parsed.mentions)
          ? parsed.mentions.filter((item): item is { snail: SnailName; raw: string } => Boolean(item?.snail && item?.raw))
          : [],
      };
      logger.debug("[MentionExtractor] Parsed result", { mentions: result.mentions });
      return result;
    } catch (error) {
      logger.warn("Failed to parse mention extraction result", {
        error: error instanceof Error ? error.message : String(error),
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
          `参与 snails: ${input.participatingSnails.map((item) => item.name).join(", ")}`,
          `消息文本: ${input.messageText}`,
        ].join("\n"),
      },
    ]);

    return this.parseExtractionResult(content, input);
  }
}
