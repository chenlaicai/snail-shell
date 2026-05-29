export interface FeishuInboundMessage {
  tenantKey: string | null;
  chatId: string;
  messageId: string;
  text: string;
}

export interface FeishuTransport {
  start(input: { onMessage: (message: FeishuInboundMessage) => void | Promise<void> }): void | Promise<void>;
  stop?(): void;
  sendText(input: { chatId: string; text: string; uuid?: string }): void | Promise<void>;
}
