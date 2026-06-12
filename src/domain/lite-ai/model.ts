/** Lite AI 配置 */
export interface LiteAIConfig {
  provider: "openai";
  openai: {
    /** OpenAI API Key */
    api_key: string;
    /** 模型 ID */
    model: string;
    /** API 基础 URL（支持任何 OpenAI 兼容服务） */
    base_url: string;
    /** 单次请求超时（毫秒） */
    timeout_ms: number;
  };
}

/** 聊天消息 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 聊天选项 */
export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
}
