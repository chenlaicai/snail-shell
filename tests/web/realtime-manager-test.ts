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
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
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
  const openedConversations: string[] = [];
  const socketErrors: Array<{ conversationId: string; error: string; clientId: string | null }> = [];
  const appendedEvents: Array<{ conversationId: string; eventId: number }> = [];
  const closedConversations: string[] = [];
  let recursiveStoreChangeCount = 0;
  const manager = createRealtimeManager({
    websocketUrl: () => "ws://localhost/ws",
    onStoreChange: (conversationId: string) => {
      recursiveStoreChangeCount += 1;
      manager.getStore(conversationId);
    },
    onMessageStarted: () => {},
    onMessageEventAppended: (conversationId: string, eventId: number) => appendedEvents.push({ conversationId, eventId }),
    onMessageStatusChanged: (conversationId: string) => statuses.push(conversationId),
    onSocketError: (conversationId: string, error: string, clientId: string | null) => socketErrors.push({ conversationId, error, clientId }),
    onSocketOpen: (conversationId: string) => openedConversations.push(conversationId),
    onSocketClose: (conversationId: string) => closedConversations.push(conversationId),
    onConversationBadge: () => {},
  });

  manager.getStore("conversation-init");
  assert(recursiveStoreChangeCount === 1, "initial store reset should not recursively create stores");

  const wsA = manager.connect("conversation-a");
  const wsB = manager.connect("conversation-b");
  wsA.onopen?.();
  assert(openedConversations.includes("conversation-a"), "websocket open should trigger caller reconciliation hook");
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
  wsA.onmessage?.({ data: JSON.stringify({ type: "agent_event", conversation_id: "conversation-a", event: { type: "message_event_appended", conversation_id: "conversation-a", message_id: 101, snail_name: "Implementation Snail", event: { id: 88, message_id: 101, seq: 2, category: "content", kind: "text", payload: { text: "missed event", mentions: [] }, source: {}, created_at: "2026-04-27T00:00:00.000Z" } } }) });
  assert(appendedEvents.some((item) => item.conversationId === "conversation-a" && item.eventId === 88), "realtime manager should expose appended event ids as cursors");
  wsA.onmessage?.({ data: JSON.stringify({ type: "error", error: "invalid message", client_id: "temp-user-error" }) });
  assert(socketErrors.some((item) => item.conversationId === "conversation-a" && item.clientId === "temp-user-error"), "websocket errors should preserve client_id for optimistic failure reconciliation");
  wsA.onerror?.();
  assert(socketErrors.some((item) => item.conversationId === "conversation-a" && item.error.includes("WebSocket")), "websocket connection errors should be observable");
  wsA.close();
  assert(closedConversations.includes("conversation-a"), "websocket close should notify caller for reconnect scheduling");
  const wsAReconnected = manager.connect("conversation-a", { afterEventId: 88 });
  assert(wsAReconnected.url.includes("after_event_id=88"), "websocket reconnect should request events after the last seen cursor");
  wsAReconnected.close();
  const wsAFromBeginning = manager.connect("conversation-a", { afterEventId: 0 });
  assert(wsAFromBeginning.url.includes("after_event_id=0"), "websocket connect should preserve cursor 0 as a valid timeline cursor");

  console.log("realtime-manager tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
