import { EventEmitter } from "events";
import { ConversationGateway } from "../../src/interaction-entry/gateway";
import { buildPlainTextEvent } from "../../src/message-bus/message-events";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

class FakeWorkspaceManager extends EventEmitter {
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

async function main(): Promise<void> {
  await testNormalizesHttpAndTransportInput();
  await testRoleNamedTransportAliasesAreAccepted();
  await testPublishesOutboundEventsToSubscribers();
  console.log("conversation gateway tests passed");
}

async function testRoleNamedTransportAliasesAreAccepted(): Promise<void> {
  const manager = new FakeWorkspaceManager();
  const gateway = new ConversationGateway(manager as any);
  const result = await gateway.sendMessage("conversation-2", { content: "你好", fromRole: "Boss Role", askerRole: "Owner Snail", clientId: "client-2" });
  assert(!("error" in result), "role-named transport fields should be accepted");
  const args = manager.sent.at(-1) as unknown[];
  assert(args[2] === "Boss Role", "fromRole should be forwarded");
  assert(args[4] === "Owner Snail", "askerRole should be forwarded");
}

async function testNormalizesHttpAndTransportInput(): Promise<void> {
  const manager = new FakeWorkspaceManager();
  const gateway = new ConversationGateway(manager as any);
  const result = await gateway.sendMessage("conversation-1", { content: "你好", clientId: "client-1" });
  assert(!("error" in result), "plain content should be accepted");
  assert(manager.sent.length === 1, "gateway should send through project manager");
  const args = manager.sent[0] as unknown[];
  assert(args[0] === "conversation-1", "conversation id should be forwarded");
  assert(JSON.stringify(args[1]) === JSON.stringify([buildPlainTextEvent("你好")]), "plain content should become text event");
  assert(args[5] === "client-1", "client id should be forwarded");
}

async function testPublishesOutboundEventsToSubscribers(): Promise<void> {
  const manager = new FakeWorkspaceManager();
  const gateway = new ConversationGateway(manager as any);
  const received: unknown[] = [];
  const unsubscribe = gateway.subscribe("conversation-1", (event) => received.push(event));
  manager.emit("agent-event", "conversation-1", { type: "message_started", message_id: 1, status: "streaming", role_name: "Owner Snail", role: "assistant" });
  unsubscribe();
  manager.emit("agent-event", "conversation-1", { type: "message_started", message_id: 2, status: "streaming", role_name: "Owner Snail", role: "assistant" });
  assert(received.length === 1, "subscriber should receive only active subscription events");
  assert((received[0] as any).conversation_id === "conversation-1", "published event should include conversation id");
}

void main().catch((error) => {
  throw error;
});
