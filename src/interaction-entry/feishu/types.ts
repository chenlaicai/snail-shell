export interface FeishuInboundMessage {
  tenantKey: string | null;
  chatId: string;
  messageId: string;
  text: string;
}

export interface FeishuTransport {
  start(input: { onMessage: (message: FeishuInboundMessage) => void | Promise<void> }): void | Promise<void>;
  stop?(): void;
  /** 发送文本消息，返回飞书 message_id（用于后续流式更新或日志追踪） */
  sendText(input: { chatId: string; text: string; uuid?: string }): Promise<string>;

  /** 更新已发送消息的内容 */
  patchText(input: { messageId: string; text: string }): Promise<void>;
}
