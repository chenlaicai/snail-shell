import { EventEmitter } from "events";
import { ConversationGateway } from "../../src/interaction-entry/gateway";
import { FeishuConversationChannel, type FeishuInboundMessage, type FeishuTransport } from "../../src/interaction-entry/feishu";
import type { FeishuConfig } from "../../src/interaction-entry/feishu/config";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

class FakeProjectManager extends EventEmitter {
  readonly sent: unknown[] = [];
  failNext = false;
  private pendingSend: Promise<void> | null = null;
  private resolvePendingSend: (() => void) | null = null;

  async sendStructuredMessage(...args: unknown[]): Promise<{ messageIds: number[] }> {
    this.sent.push(args);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("temporary conversation failure");
    }
    if (this.pendingSend) await this.pendingSend;
    return { messageIds: [1] };
  }

  blockNextSend(): void {
    this.pendingSend = new Promise((resolve) => {
      this.resolvePendingSend = resolve;
    });
  }

  unblockSend(): void {
    this.resolvePendingSend?.();
    this.pendingSend = null;
    this.resolvePendingSend = null;
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
  failNextSend = false;

  start(input: { onMessage: (message: FeishuInboundMessage) => void | Promise<void> }): void {
    this.onMessage = input.onMessage;
  }

  sendText(input: { chatId: string; text: string; uuid?: string }): void {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("temporary Feishu send failure");
    }
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
  await testInboundAckDoesNotWaitForConversationProcessing();
  await testTenantBoundChatRejectsMissingOrDifferentTenant();
  await testDuplicateInboundMessageIsIgnoredAfterSuccess();
  await testFailedInboundMessageCanBeRetried();
  await testInboundDedupeHasCapacityBoundary();
  await testOutboundAssistantEventPushesToBoundChat();
  await testOutboundSendFailureDoesNotBreakLaterPushes();
  await testBossMessagesAreNotEchoedByDefault();
  console.log("feishu channel tests passed");
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
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

async function testInboundAckDoesNotWaitForConversationProcessing(): Promise<void> {
  const manager = new FakeProjectManager();
  manager.blockNextSend();
  const gateway = new ConversationGateway(manager as any);
  const transport = new FakeFeishuTransport();
  const channel = new FeishuConversationChannel(config, gateway, transport);
  await channel.start();

  const result = transport.onMessage?.({ tenantKey: "tenant-1", chatId: "chat-1", messageId: "msg-ack", text: "不要阻塞 ack" });
  assert(!result || typeof (result as Promise<void>).then !== "function", "Feishu onMessage should return before conversation processing completes");
  await waitFor(() => manager.sent.length === 1, "background send should still enter conversation gateway");
  manager.unblockSend();
  await channel.stop();
}

async function testTenantBoundChatRejectsMissingOrDifferentTenant(): Promise<void> {
  const manager = new FakeProjectManager();
  const gateway = new ConversationGateway(manager as any);
  const transport = new FakeFeishuTransport();
  const channel = new FeishuConversationChannel(config, gateway, transport);
  await channel.start();

  transport.onMessage?.({ tenantKey: null, chatId: "chat-1", messageId: "msg-missing-tenant", text: "缺租户" });
  transport.onMessage?.({ tenantKey: "tenant-2", chatId: "chat-1", messageId: "msg-other-tenant", text: "错租户" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(manager.sent.length === 0, "tenant-bound Feishu chat should reject missing or different tenant_key");
  await channel.stop();
}

async function testDuplicateInboundMessageIsIgnoredAfterSuccess(): Promise<void> {
  const manager = new FakeProjectManager();
  const gateway = new ConversationGateway(manager as any);
  const transport = new FakeFeishuTransport();
  const channel = new FeishuConversationChannel(config, gateway, transport);
  await channel.start();

  transport.onMessage?.({ tenantKey: "tenant-1", chatId: "chat-1", messageId: "msg-duplicate", text: "第一次" });
  await waitFor(() => manager.sent.length === 1, "first duplicate test message should be sent");
  transport.onMessage?.({ tenantKey: "tenant-1", chatId: "chat-1", messageId: "msg-duplicate", text: "第二次" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(manager.sent.length === 1, "processed Feishu message_id should be deduplicated after successful send");
  await channel.stop();
}

async function testFailedInboundMessageCanBeRetried(): Promise<void> {
  const manager = new FakeProjectManager();
  manager.failNext = true;
  const gateway = new ConversationGateway(manager as any);
  const transport = new FakeFeishuTransport();
  const channel = new FeishuConversationChannel(config, gateway, transport);
  await channel.start();

  transport.onMessage?.({ tenantKey: "tenant-1", chatId: "chat-1", messageId: "msg-retry", text: "失败后重试" });
  await waitFor(() => manager.sent.length === 1, "failed Feishu message should attempt send once");
  await new Promise((resolve) => setTimeout(resolve, 0));
  transport.onMessage?.({ tenantKey: "tenant-1", chatId: "chat-1", messageId: "msg-retry", text: "失败后重试" });
  await waitFor(() => manager.sent.length === 2, "failed Feishu message_id should not be marked processed before success");
  await channel.stop();
}

async function testInboundDedupeHasCapacityBoundary(): Promise<void> {
  const manager = new FakeProjectManager();
  const gateway = new ConversationGateway(manager as any);
  const transport = new FakeFeishuTransport();
  const channel = new FeishuConversationChannel(config, gateway, transport, { maxEntries: 1 });
  await channel.start();

  transport.onMessage?.({ tenantKey: "tenant-1", chatId: "chat-1", messageId: "msg-old", text: "旧消息" });
  await waitFor(() => manager.sent.length === 1, "old message should be sent");
  transport.onMessage?.({ tenantKey: "tenant-1", chatId: "chat-1", messageId: "msg-new", text: "新消息" });
  await waitFor(() => manager.sent.length === 2, "new message should be sent");
  await new Promise((resolve) => setTimeout(resolve, 0));
  transport.onMessage?.({ tenantKey: "tenant-1", chatId: "chat-1", messageId: "msg-old", text: "旧消息再次出现" });
  await waitFor(() => manager.sent.length === 3, "old processed message should be retryable after dedupe eviction");
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
    role_name: "Owner Snail",
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
    role_name: "Boss Role",
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

  assert(transport.sent.length === 0, "Boss Role inbound messages should not be echoed to Feishu by default");
  await channel.stop();
}

async function testOutboundSendFailureDoesNotBreakLaterPushes(): Promise<void> {
  const manager = new FakeProjectManager();
  const gateway = new ConversationGateway(manager as any);
  const transport = new FakeFeishuTransport();
  const channel = new FeishuConversationChannel(config, gateway, transport);
  await channel.start();

  transport.failNextSend = true;
  emitAssistantText(manager, 20, 30, "第一次发送失败");
  await new Promise((resolve) => setTimeout(resolve, 0));
  emitAssistantText(manager, 21, 31, "第二次应该继续发送");

  await waitFor(() => transport.sent.length === 1, "failed Feishu push should not break later outbound pushes");
  assert(transport.sent[0]?.text.includes("第二次应该继续发送"), "later outbound text should still be sent after a previous failure");
  await channel.stop();
}

function emitAssistantText(manager: FakeProjectManager, messageId: number, eventId: number, text: string): void {
  manager.emit("agent-event", "conversation-1", {
    type: "message_event_appended",
    message_id: messageId,
    role_name: "Owner Snail",
    event: {
      id: eventId,
      message_id: messageId,
      seq: 2,
      category: "content",
      kind: "text",
      payload: { text, mentions: [] },
      source: { runtime_name: null, runtime_event_type: null, runtime_message_id: null, runtime_item_id: null, runtime_call_id: null, raw_event: null, metadata: null },
      created_at: new Date().toISOString(),
    },
  });
}

void main().catch((error) => {
  throw error;
});
