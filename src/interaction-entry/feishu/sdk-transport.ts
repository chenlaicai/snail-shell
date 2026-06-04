import { logger } from "../../logger";
import type { FeishuInboundMessage, FeishuTransport } from "./types";

interface FeishuSdkModule {
  /** SDK 类型定义不完整，patch 未在官方类型中声明但运行时可用 */
  Client: new (config: { appId: string; appSecret: string }) => { im: { v1: { message: { create(input: unknown): Promise<unknown>; patch(input: unknown): Promise<unknown> } } } };
  WSClient: new (config: { appId: string; appSecret: string }) => { start(input: unknown): void; close?: () => void };
  EventDispatcher: new (config: Record<string, unknown>) => { register(handlers: Record<string, (data: unknown) => Promise<void> | void>): unknown };
}

export class FeishuSdkTransport implements FeishuTransport {
  private client: InstanceType<FeishuSdkModule["Client"]> | null = null;
  private wsClient: InstanceType<FeishuSdkModule["WSClient"]> | null = null;

  constructor(private readonly input: { appId: string; appSecret: string }) {}

  async start(input: { onMessage: (message: FeishuInboundMessage) => void | Promise<void> }): Promise<void> {
    const sdk = loadFeishuSdk();
    this.client = new sdk.Client({ appId: this.input.appId, appSecret: this.input.appSecret });
    this.wsClient = new sdk.WSClient({ appId: this.input.appId, appSecret: this.input.appSecret });
    const dispatcher = new sdk.EventDispatcher({}).register({
      "im.message.receive_v1": (data: unknown) => {
        const message = parseReceiveMessageEvent(data);
        if (!message) return;
        void Promise.resolve(input.onMessage(message)).catch((error: unknown) => {
          logger.error("Feishu inbound message handler failed", { error: error instanceof Error ? error.message : String(error) });
        });
      },
    });
    this.wsClient.start({ eventDispatcher: dispatcher });
  }

  stop(): void {
    this.wsClient?.close?.();
  }

  async sendText(input: { chatId: string; text: string; uuid?: string }): Promise<string> {
    if (!this.client) throw new Error("Feishu transport has not started");
    const resp = await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: input.chatId,
        msg_type: "text",
        content: JSON.stringify({ text: input.text }),
        ...(input.uuid ? { uuid: input.uuid } : {}),
      },
    });
    // @larksuiteoapi/node-sdk 类型定义不完整，resp 实际包含 data.message_id
    const messageId = (resp as any).data?.message_id;
    if (typeof messageId !== "string" || !messageId) {
      throw new Error("Feishu sendText response missing message_id");
    }
    return messageId;
  }

  async patchText(input: { messageId: string; text: string }): Promise<void> {
    if (!this.client) throw new Error("Feishu transport has not started");
    // @larksuiteoapi/node-sdk 类型定义未包含 patch 方法，运行时已验证可用
    await (this.client.im.v1.message as any).patch({
      path: { message_id: input.messageId },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text: input.text }),
      },
    });
  }
}

function loadFeishuSdk(): FeishuSdkModule {
  try {
    /**
     * 飞书 SDK 是可选运行时依赖：未启用飞书时不能影响 Web 接入；启用时再要求依赖存在，避免默认本地开发和测试被外部集成绑定。
     */
    return require("@larksuiteoapi/node-sdk") as FeishuSdkModule;
  } catch (error) {
    throw new Error("Feishu integration is enabled but @larksuiteoapi/node-sdk is not installed", { cause: error });
  }
}

function parseReceiveMessageEvent(data: unknown): FeishuInboundMessage | null {
  const event = data as any;
  const message = event?.message;
  const chatId = message?.chat_id;
  const messageId = message?.message_id;
  if (typeof chatId !== "string" || typeof messageId !== "string") return null;
  const text = parseTextContent(message?.content);
  if (!text.trim()) {
    logger.debug("Ignoring non-text Feishu message", { chatId, messageId });
    return null;
  }
  return {
    tenantKey: typeof event?.tenant_key === "string" ? event.tenant_key : null,
    chatId,
    messageId,
    text,
  };
}

function parseTextContent(content: unknown): string {
  if (typeof content !== "string") return "";
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return content;
  }
}
