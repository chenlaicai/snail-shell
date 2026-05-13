import type { OpenAIClient } from "../llm/openai";
import { OpenAIConversationSummaryGenerator } from "../llm/summary";
import type { ConversationSummaryInput, MessageContextSummaryInput } from "../llm/summary";
import { OpenAIMentionExtractor } from "../llm/mention-extractor";
import type { MentionExtractionInput, MentionExtractionResult } from "../llm/mention-extractor";

export type { ConversationSummaryInput, MessageContextSummaryInput, MentionExtractionInput, MentionExtractionResult };

/** SystemAI 的公开接口，供依赖方（如 ProjectManager）使用。 */
export interface SystemAI {
  generateConversationSummary(input: ConversationSummaryInput): Promise<string>;
  generateMessageContextSummary(input: MessageContextSummaryInput): Promise<string>;
  extractMentions(input: MentionExtractionInput): Promise<MentionExtractionResult>;
}

/**
 * SystemAISnail 是 Snail Den 中的特殊小蜗牛，
 * 使用 OpenAI 直接调用（不经过 CLI agent），
 * 负责摘要生成和提及提取等系统辅助任务。
 */
export class SystemAISnail implements SystemAI {
  private readonly summaryGenerator: OpenAIConversationSummaryGenerator;
  private readonly mentionExtractor: OpenAIMentionExtractor;

  constructor(client: OpenAIClient) {
    this.summaryGenerator = new OpenAIConversationSummaryGenerator(client);
    this.mentionExtractor = new OpenAIMentionExtractor(client);
  }

  async generateConversationSummary(input: ConversationSummaryInput): Promise<string> {
    return this.summaryGenerator.generateConversationSummary(input);
  }

  async generateMessageContextSummary(input: MessageContextSummaryInput): Promise<string> {
    return this.summaryGenerator.generateMessageContextSummary(input);
  }

  async extractMentions(input: MentionExtractionInput): Promise<MentionExtractionResult> {
    return this.mentionExtractor.extractMentions(input);
  }
}
