import type { ChatMessage, ChatOptions } from "@domain/lite-ai/model";

/** Lite AI 端口定义 — 纯 OpenAI 兼容聊天客户端 */
export interface LiteAIPort {
  /** 是否已配置（API key 存在） */
  getConfig(): boolean;
  /** 聊天补全 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
