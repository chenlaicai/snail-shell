import type { IMInboundMessage } from "@domain/im/model";
import type { IMTransport } from "@domain/im/port";

/**
 * 飞书传输层实现。
 * 使用 Hono 处理 webhook 回调。
 */
export class FeishuTransport implements IMTransport {
  private messageHandler: ((msg: IMInboundMessage) => void) | null = null;
  private appId: string;
  private appSecret: string;

  constructor(config: { appId: string; appSecret: string }) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
  }

  async prepare(): Promise<void> {
    // 飞书 SDK 初始化（如果需要）
  }

  async stop(): Promise<void> {
    // 清理资源
  }

  onMessage(handler: (msg: IMInboundMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendText(chatId: string, text: string, uuid?: string): Promise<string> {
    // 使用飞书 API 发送消息
    const token = await this.getAccessToken();
    const response = await fetch("https://open.feishu.cn/open-apis/im/v1/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
        uuid,
      }),
    });

    const result = await response.json();
    return (result as { data: { message_id: string } }).data.message_id;
  }

  async patchText(messageId: string, text: string): Promise<void> {
    // 使用飞书 API 更新消息（流式响应）
    const token = await this.getAccessToken();
    await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    });
  }

  /** 处理 webhook 回调 */
  handleWebhook(body: unknown): void {
    const data = body as Record<string, unknown>;
    const event = data.event as Record<string, unknown> | undefined;
    if (!event) return;

    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return;

    const chatId = message.chat_id as string;
    const messageId = message.message_id as string;
    const content = JSON.parse(message.content as string);
    const text = content.text as string;

    if (this.messageHandler) {
      this.messageHandler({
        chat_id: chatId,
        message_id: messageId,
        text,
        tenant_key: data.tenant_key as string | undefined,
      });
    }
  }

  private async getAccessToken(): Promise<string> {
    // 获取飞书 access token
    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    const result = await response.json();
    return (result as { tenant_access_token: string }).tenant_access_token;
  }
}
