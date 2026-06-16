import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { IMAdapter } from "@domain/im/_internal/adapter";

/**
 * IM Hono Server。
 * 使用 Hono 处理 webhook 回调，消息解析委托给 LobbyAwareChannel。
 */
export class IMHonoServer {
  private app: Hono;

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

    // 飞书 Webhook → 委托给 LobbyAwareChannel
    this.app.post("/webhook/feishu", async (c) => {
      const body = await c.req.json();
      const channel = this.imAdapter.getChannel("feishu");
      channel?.handleWebhook?.(body);
      return c.json({ ok: true });
    });

    // 飞书验证（GET 请求）
    this.app.get("/webhook/feishu", (c) => {
      const challenge = c.req.query("challenge");
      return c.json({ challenge });
    });

    // 企微 Webhook → 委托给 LobbyAwareChannel
    this.app.post("/webhook/wecom", async (c) => {
      const body = await c.req.text();
      const channel = this.imAdapter.getChannel("wecom");
      channel?.handleWebhook?.(body);
      return c.text("success");
    });

    // 企微验证（GET 请求）
    this.app.get("/webhook/wecom", (c) => {
      const echostr = c.req.query("echostr");
      return c.text(echostr || "");
    });
  }

  /** 获取 Hono 应用实例（用于挂载到主服务器） */
  getApp(): Hono {
    return this.app;
  }
}
