import type { IMInboundMessage } from "@domain/im/model";
import type { IMTransport } from "@domain/im/port";

/**
 * Hono WebSocket 传输层实现。
 * 使用 Hono 的原生 WebSocket 支持。
 */
export class HonoWebSocketTransport implements IMTransport {
  private ws: WebSocket | null = null;
  private messageHandler: ((msg: IMInboundMessage) => void) | null = null;

  constructor(private url: string) {}

  async prepare(): Promise<void> {
    // WebSocket 连接在需要时建立
  }

  async stop(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onMessage(handler: (msg: IMInboundMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendText(chatId: string, text: string, uuid?: string): Promise<string> {
    // 通过 HTTP API 发送消息
    const response = await fetch(`${this.url}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, text, uuid }),
    });

    const result = await response.json();
    return (result as { messageId: string }).messageId;
  }

  async patchText(messageId: string, text: string): Promise<void> {
    // 通过 HTTP API 更新消息
    await fetch(`${this.url}/api/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }
}

/**
 * Hono HTTP 传输层实现。
 * 用于处理 webhook 回调。
 */
export class HonoHttpTransport implements IMTransport {
  private messageHandler: ((msg: IMInboundMessage) => void) | null = null;

  constructor(private baseUrl: string) {}

  async prepare(): Promise<void> {
    // HTTP 传输不需要准备
  }

  async stop(): Promise<void> {
    // HTTP 传输不需要停止
  }

  onMessage(handler: (msg: IMInboundMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendText(chatId: string, text: string, uuid?: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, text, uuid }),
    });

    const result = await response.json();
    return (result as { messageId: string }).messageId;
  }

  async patchText(messageId: string, text: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }
}
