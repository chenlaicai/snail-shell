import type { ChatMessage, ChatOptions, LiteAIConfig } from "@domain/lite-ai/model";

/**
 * OpenAI 兼容 HTTP 客户端。
 * 裸 HTTP 调用，无 SDK 依赖。
 */
export class OpenAIClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config: LiteAIConfig["openai"]) {
    this.apiKey = config.api_key;
    this.model = config.model;
    this.baseUrl = config.base_url.replace(/\/$/, "");
    this.timeoutMs = config.timeout_ms;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const temperature = options?.temperature ?? 0.2;
    const maxTokens = options?.max_tokens;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature,
    };

    if (maxTokens) {
      body.max_tokens = maxTokens;
    }

    const response = await this.fetchWithRetry(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return this.parseResponse(data);
  }

  private async fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        // 5xx/429 重试
        if (response.status >= 500 || response.status === 429) {
          lastError = new Error(`HTTP ${response.status}`);
          await this.delay(1000 * Math.pow(2, i));
          continue;
        }

        return response;
      } catch (err) {
        lastError = err as Error;
        if (i < retries - 1) {
          await this.delay(1000 * Math.pow(2, i));
        }
      }
    }

    throw lastError || new Error("Max retries exceeded");
  }

  private parseResponse(data: unknown): string {
    const result = data as Record<string, unknown>;
    const choices = result.choices as Array<Record<string, unknown>> | undefined;

    if (!choices?.length) {
      return "";
    }

    const choice = choices[0];
    const message = choice.message as Record<string, unknown> | undefined;

    if (message?.content) {
      return message.content as string;
    }

    // 兼容其他格式
    const text = (choice.text as string) || (result.output_text as string) || "";
    return text;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
