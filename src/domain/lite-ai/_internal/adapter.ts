import type { ChatMessage, ChatOptions } from "@domain/lite-ai/model";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { LiteAIRepository } from "@domain/lite-ai/_internal/repository";
import { OpenAIClient } from "@domain/lite-ai/_internal/openai-client";

/**
 * Lite AI 适配器 — 纯 OpenAI 兼容聊天客户端。
 * 业务场景（mention 提取、摘要生成等）由 app 层实现。
 */
export class LiteAIAdapter implements LiteAIPort {
  private client: OpenAIClient | null = null;

  constructor(private repo: LiteAIRepository) {
    const config = repo.getConfig();
    if (config) {
      this.client = new OpenAIClient(config.openai);
    }
  }

  getConfig(): boolean {
    return this.client !== null;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    if (!this.client) {
      throw new Error("Lite AI not configured");
    }
    return this.client.chat(messages, options);
  }
}
