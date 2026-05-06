import { EventEmitter } from "events";
import { ConversationGateway } from "../../src/conversation/gateway";
import { FeishuConversationChannel, type FeishuInboundMessage, type FeishuTransport } from "../../src/integrations/feishu";
import type { FeishuConfig } from "../../src/integrations/feishu/config";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

class FakeProjectManager extends EventEmitter {
  readonly sent: unknown[] = [];

  async sendStructuredMessage(...args: unknown[]): Promise<{ messageIds: number[] }> {
    this.sent.push(args);
    return { messageIds: [1] };
  }

  getLastConversationEventId(): number {
    return 0;
  }

  getConversationEventsBetween(): unknown[] {
    return [];
  }
}

class FakeFeishuTransport implements FeishuTransport {
  onMessage: ((message: FeishuInboundMessage) => void | Promise<void>) | null = null;
  readonly sent: Array<{ chatId: string; text: string; uuid?: string }> = [];

  start(input: { onMessage: (message: FeishuInboundMessage) => void | Promise<void> }): void {
    this.onMessage = input.onMessage;
  }

  sendText(input: { chatId: string; text: string; uuid?: string }): void {
    this.sent.push(input);
  }
}

const config: FeishuConfig = {
  enabled: true,
  app_id_env: "FEISHU_APP_ID",
  app_secret_env: "FEISHU_APP_SECRET",
  bindings: [{ tenant_key: "tenant-1", chat_id: "chat-1", conversation_id: "conversation-1" }],
  message_push: { max_text_length: 1000, include_user_messages: false },
};

async function main(): Promise<void> {
  await testInboundFeishuMessageUsesConversationGateway();
  await testOutboundAssistantEventPushesToBoundChat();
  await testBossMessagesAreNotEchoedByDefault();
  console.log("feishu channel tests passed");
}

async function testInboundFeishuMessageUsesConversationGateway(): Promise<void> {
  const manager = new FakeProjectManager();
  const gateway = new ConversationGateway(manager as any);
  const transport = new FakeFeishuTransport();
  const channel = new FeishuConversationChannel(config, gateway, transport);
  await channel.start();
  await transport.onMessage?.({ tenantKey: "tenant-1", chatId: "chat-1", messageId: "msg-1", text: "帮我看下" });

  assert(manager.sent.length === 1, "bound Feishu message should enter conversation gateway");
  const args = manager.sent[0] as unknown[];
  assert(args[0] === "conversation-1", "Feishu chat should map to configured conversation");
  assert(args[5] === "feishu:tenant-1:chat-1:msg-1", "Feishu message id should become stable client id");
  await channel.stop();
}

async function testOutboundAssistantEventPushesToBoundChat(): Promise<void> {
  const manager = new FakeProjectManager();
  const gateway = new ConversationGateway(manager as any);
  const transport = new FakeFeishuTransport();
  const channel = new FeishuConversationChannel(config, gateway, transport);
  await channel.start();

  manager.emit("agent-event", "conversation-1", {
    type: "message_event_appended",
    message_id: 2,
    snail_name: "Owner Snail",
    event: {
      id: 10,
      message_id: 2,
      seq: 2,
      category: "content",
      kind: "text",
      payload: { text: "处理好了", mentions: [] },
      source: { runtime_name: null, runtime_event_type: null, runtime_message_id: null, runtime_item_id: null, runtime_call_id: null, raw_event: null, metadata: null },
      created_at: new Date().toISOString(),
    },
  });

  assert(transport.sent.length === 1, "assistant content event should be pushed to Feishu");
  assert(transport.sent[0]?.chatId === "chat-1", "outbound message should target bound chat");
  assert(transport.sent[0]?.text.includes("Owner Snail") && transport.sent[0]?.text.includes("处理好了"), "outbound text should include snail name and content");
  await channel.stop();
}

async function testBossMessagesAreNotEchoedByDefault(): Promise<void> {
  const manager = new FakeProjectManager();
  const gateway = new ConversationGateway(manager as any);
  const transport = new FakeFeishuTransport();
  const channel = new FeishuConversationChannel(config, gateway, transport);
  await channel.start();

  manager.emit("agent-event", "conversation-1", {
    type: "message_event_appended",
    message_id: 1,
    snail_name: "Boss Snail",
    event: {
      id: 11,
      message_id: 1,
      seq: 2,
      category: "content",
      kind: "text",
      payload: { text: "用户原文", mentions: [] },
      source: { runtime_name: null, runtime_event_type: null, runtime_message_id: null, runtime_item_id: null, runtime_call_id: null, raw_event: null, metadata: null },
      created_at: new Date().toISOString(),
    },
  });

  assert(transport.sent.length === 0, "Boss Snail inbound messages should not be echoed to Feishu by default");
  await channel.stop();
}

void main().catch((error) => {
  throw error;
});
