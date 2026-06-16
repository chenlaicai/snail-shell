import type { Express } from "express";

export interface IMInboundMessage {
  tenantKey: string | null;
  chatId: string;
  messageId: string;
  text: string;
}

/** 传递给 prepare() 的平台上下文；各 transport 按需取用 */
export interface IMTransportContext {
  /** HTTP 回调型 transport 挂载路由用；WebSocket 型忽略 */
  app?: Express;
}

export interface IMTransport {
  /** 第一步：准备通道。WebSocket 型初始化 Client，HTTP 回调型挂载路由。 */
  prepare(context: IMTransportContext): Promise<void>;
  /** 第二步：设置消息回调并开始接收。prepare() 之后调用。 */
  onMessage(handler: (message: IMInboundMessage) => void | Promise<void>): void;
  /** 停止通道 */
  stop?(): void;
  /** 发送文本消息，返回平台 message_id（用于后续更新或日志追踪） */
  sendText(input: { chatId: string; text: string; uuid?: string }): Promise<string>;
  /** 更新已发送消息的内容（飞书流式场景等） */
  patchText?(input: { messageId: string; text: string }): Promise<void>;
}
