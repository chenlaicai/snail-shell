import type {
  ChatMessage,
  ChatOptions,
  MentionExtractionResult,
  ConversationSummaryInput,
  MessageContextSummaryInput,
} from "./model";

/** Lite AI 端口定义 */
export interface LiteAIPort {
  /** 聊天补全 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;

  /** 提取 mention */
  extractMentions(
    messageText: string,
    participatingRoles: Array<{ name: string }>,
  ): Promise<MentionExtractionResult>;

  /** 生成对话摘要 */
  generateConversationSummary(input: ConversationSummaryInput): Promise<string>;

  /** 生成消息上下文摘要 */
  generateMessageContextSummary(input: MessageContextSummaryInput): Promise<string>;
}
