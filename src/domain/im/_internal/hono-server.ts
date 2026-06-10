import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { IMInboundMessage } from "@domain/im/model";
import type { IMAdapter } from "./adapter";

/**
 * IM Hono Server。
 * 使用 Hono 处理 webhook 回调和 WebSocket。
 */
export class IMHonoServer {
  private app: Hono;
  private messageHandler: ((msg: IMInboundMessage) => void) | null = null;

  constructor(private imAdapter: IMAdapter) {
    this.app = new Hono();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use("*", logger());
    this.app.use("*", cors());
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get("/health", (c) => {
      return c.json({ status: "ok", channels: this.imAdapter.listChannelConfigs() });
    });

    // 飞书 Webhook
    this.app.post("/webhook/feishu", async (c) => {
      const body = await c.req.json();
      const msg = this.parseFeishuMessage(body);

      if (msg && this.messageHandler) {
        this.messageHandler(msg);
      }

      return c.json({ ok: true });
    });

    // 飞书验证（GET 请求）
    this.app.get("/webhook/feishu", (c) => {
      const challenge = c.req.query("challenge");
      return c.json({ challenge });
    });

    // 企微 Webhook
    this.app.post("/webhook/wecom", async (c) => {
      const body = await c.req.text();
      const msg = this.parseWecomMessage(body);

      if (msg && this.messageHandler) {
        this.messageHandler(msg);
      }

      return c.text("success");
    });

    // 企微验证（GET 请求）
    this.app.get("/webhook/wecom", (c) => {
      const echostr = c.req.query("echostr");
      return c.text(echostr || "");
    });

    // WebSocket 端点（用于实时消息推送）
    this.app.get("/ws", (c) => {
      // Hono 的 WebSocket 处理
      return c.text("WebSocket endpoint");
    });
  }

  private parseFeishuMessage(body: unknown): IMInboundMessage | null {
    const data = body as Record<string, unknown>;
    const event = data.event as Record<string, unknown> | undefined;
    if (!event) return null;

    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return null;

    const chatId = message.chat_id as string;
    const messageId = message.message_id as string;
    const content = JSON.parse(message.content as string);
    const text = content.text as string;

    return {
      chat_id: chatId,
      message_id: messageId,
      text,
      tenant_key: data.tenant_key as string | undefined,
    };
  }

  private parseWecomMessage(body: string): IMInboundMessage | null {
    // 简单的 XML 解析（实际应该用 XML 库）
    const chatIdMatch = body.match(/<ChatId><!\[CDATA\[(.*?)\]\]><\/ChatId>/);
    const contentMatch = body.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/);
    const msgIdMatch = body.match(/<MsgId>(.*?)<\/MsgId>/);

    if (!chatIdMatch || !contentMatch || !msgIdMatch) return null;

    return {
      chat_id: chatIdMatch[1],
      message_id: msgIdMatch[1],
      text: contentMatch[1],
    };
  }

  /** 设置消息处理器 */
  onMessage(handler: (msg: IMInboundMessage) => void): void {
    this.messageHandler = handler;
  }

  /** 获取 Hono 应用实例（用于挂载到主服务器） */
  getApp(): Hono {
    return this.app;
  }
}
