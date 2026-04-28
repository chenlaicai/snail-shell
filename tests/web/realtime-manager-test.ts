import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(value: string): void { this.sent.push(value); }
  close(): void { this.readyState = 3; this.onclose?.(); }
}

async function importWebModule<T>(relativePath: string): Promise<T> {
  const modulePath = path.resolve(__dirname, relativePath);
  let moduleSource = fs.readFileSync(modulePath, "utf8");
  moduleSource = moduleSource.replace('import { createMessageStore } from "./message-store.js";', fs.readFileSync(path.resolve(__dirname, "../../src/web/message-store.js"), "utf8"));
  moduleSource = moduleSource.replace('import { isCurrentConversationEvent } from "./realtime-guard.js";', fs.readFileSync(path.resolve(__dirname, "../../src/web/realtime-guard.js"), "utf8"));
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "WebSocket", "globalThis.WebSocket = WebSocket; return import(moduleUrl);") as (moduleUrl: string, webSocket: typeof FakeWebSocket) => Promise<T>;
  return dynamicImport(moduleUrl, FakeWebSocket);
}

async function main(): Promise<void> {
  const { createRealtimeManager } = await importWebModule<{ createRealtimeManager: (input: any) => any }>("../../src/web/realtime-manager.js");
  const statuses: string[] = [];
  const manager = createRealtimeManager({
    websocketUrl: () => "ws://localhost/ws",
    onStoreChange: () => {},
    onMessageStarted: () => {},
    onMessageStatusChanged: (conversationId: string) => statuses.push(conversationId),
    onSocketError: () => {},
    onConversationBadge: () => {},
  });

  const wsA = manager.connect("conversation-a");
  const wsB = manager.connect("conversation-b");
  assert(wsA !== wsB, "different conversations should keep separate websocket connections");
  assert(manager.connect("conversation-a") === wsA, "connecting an existing conversation should reuse its websocket");

  wsB.onmessage?.({ data: JSON.stringify({ type: "agent_event", conversation_id: "conversation-b", event: { type: "message_started", conversation_id: "conversation-b", message_id: 202, status: "streaming", snail_name: "Implementation Snail", role: "assistant" } }) });
  assert(manager.getStore("conversation-b").getState().records.length === 1, "background conversation should receive its own event");
  assert(manager.getStore("conversation-a").getState().records.length === 0, "background event must not mutate another conversation store");
  wsA.onmessage?.({ data: JSON.stringify({ type: "agent_event", conversation_id: "conversation-b", event: { type: "message_started", conversation_id: "conversation-b", message_id: 303, status: "streaming", snail_name: "Implementation Snail", role: "assistant" } }) });
  assert(manager.getStore("conversation-a").getState().records.length === 0, "mislabeled events on a websocket should be ignored");
  assert(manager.getStore("conversation-b").getState().records.length === 1, "mislabeled events must not be routed by payload alone");

  assert(manager.send("conversation-a", { type: "send_message", content: "hi" }) === true, "send should use an open conversation websocket");
  assert(wsA.sent.length === 1, "send should write to the selected conversation websocket");

  console.log("realtime-manager tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
