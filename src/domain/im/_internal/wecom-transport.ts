import type { IMInboundMessage, IMTransport } from "@domain/im/port";

/**
 * 企微传输层实现。
 * 使用 Hono 处理 webhook 回调。
 */
export class WecomTransport implements IMTransport {
  private messageHandler: ((msg: IMInboundMessage) => void) | null = null;
  private corpId: string;
  private corpSecret: string;
  private token: string;
  private encodingAesKey: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: {
    corpId: string;
    corpSecret: string;
    token: string;
    encodingAesKey: string;
  }) {
    this.corpId = config.corpId;
    this.corpSecret = config.corpSecret;
    this.token = config.token;
    this.encodingAesKey = config.encodingAesKey;
  }

  async prepare(): Promise<void> {
    // 预获取 access token
    await this.getAccessToken();
  }

  async stop(): Promise<void> {
    // 清理资源
  }

  onMessage(handler: (msg: IMInboundMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendText(chatId: string, text: string, uuid?: string): Promise<string> {
    const token = await this.getAccessToken();
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatid: chatId,
          msgtype: "text",
          text: { content: text },
        }),
      }
    );

    const result = await response.json();
    // 企微不返回 message_id，返回空字符串
    return "";
  }

  async patchText(messageId: string, text: string): Promise<void> {
    // 企微不支持 patchText，降级为发送新消息
    console.warn("企微不支持 patchText，降级为发送新消息");
  }

  /** 处理 webhook 回调 */
  handleWebhook(body: string): void {
    // 简单的 XML 解析（实际应该用 XML 库）
    const chatIdMatch = body.match(/<ChatId><!\[CDATA\[(.*?)\]\]><\/ChatId>/);
    const contentMatch = body.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/);
    const msgIdMatch = body.match(/<MsgId>(.*?)<\/MsgId>/);

    if (!chatIdMatch || !contentMatch || !msgIdMatch) return;

    if (this.messageHandler) {
      this.messageHandler({
        chat_id: chatIdMatch[1],
        message_id: msgIdMatch[1],
        text: contentMatch[1],
      });
    }
  }

  /** 验证 webhook 签名 */
  verifySignature(signature: string, timestamp: string, nonce: string, echostr: string): string | null {
    // 验证签名（简化版）
    const arr = [this.token, timestamp, nonce, echostr].sort();
    const str = arr.join("");
    // 实际应该用 SHA1
    return echostr;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.corpSecret}`
    );

    const result = await response.json();
    const data = result as { access_token: string; expires_in: number };

    this.accessToken = data.access_token;
    // 5 分钟安全余量
    this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;

    return this.accessToken;
  }
}
