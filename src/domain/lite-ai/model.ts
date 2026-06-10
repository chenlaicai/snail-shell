/** LLM 配置 */
export interface LlmConfig {
  provider: "openai";
  openai: {
    api_key: string;
    model: string;
    base_url: string;
    timeout_ms: number;
  };
}

/** OpenAI 聊天消息 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenAI 聊天选项 */
export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
}

/** Mention 提取结果 */
export interface MentionExtractionResult {
  mentions: Array<{ role: string; raw: string }>;
}

/** 对话摘要输入 */
export interface ConversationSummaryInput {
  title: string;
  kind: string;
  previous_summary: string | null;
  messages: Array<{ role: string; content: string }>;
}

/** 消息上下文摘要输入 */
export interface MessageContextSummaryInput {
  target_chars: number;
  context: string;
}
