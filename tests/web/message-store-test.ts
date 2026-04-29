import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/message-store.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ createMessageStore: (onChange?: (() => void) | undefined) => any }>;
  const { createMessageStore } = await dynamicImport(moduleUrl);
  const store = createMessageStore();

  store.reset("conversation-a");
  store.addOptimisticMessage({ clientId: "temp-user-1", conversation_id: "conversation-a", role: "user", from_snail: "Boss Snail", quoted_message_id: null, quoted_message: null, created_at: "2026-04-27T00:00:00.000Z", events: [{ kind: "text", payload: { text: "hi", mentions: [] } }] });
  store.applyRealtimeStart({ type: "message_started", conversation_id: "conversation-a", message_id: 101, status: "streaming", snail_name: "Boss Snail", role: "user", client_id: "temp-user-1" });

  let current = store.getState();
  assert(current.records.length === 1, "realtime start should upgrade optimistic user message instead of duplicating it");
  assert(current.records[0].id === 101, "upgraded record should carry persisted message id");
  assert(current.records[0].key === "message:101", "upgraded record should use persisted message key");
  assert(current.records[0].optimistic === false, "upgraded record should no longer be optimistic");

  store.applyRealtimeEvent({ type: "message_event_appended", conversation_id: "conversation-a", message_id: 101, snail_name: "Boss Snail", client_id: "temp-user-1", event: { id: 1, message_id: 101, seq: 1, category: "signal", kind: "start", payload: { role: "user", snail_name: "Boss Snail", runtime: "system" }, source: {}, created_at: "2026-04-27T00:00:01.000Z" } });
  current = store.getState();
  assert(current.records[0].role === "user", "user realtime events must not downgrade Boss messages into assistant messages");
  assert(current.records[0].statusView !== "thinking", "Boss messages should not derive a thinking status from start events");
  store.applyRealtimeEvent({ type: "message_event_appended", conversation_id: "conversation-a", message_id: 101, snail_name: "Boss Snail", client_id: "temp-user-1", event: { id: 2, message_id: 101, seq: 2, category: "content", kind: "text", payload: { text: "hi", mentions: [] }, source: {}, created_at: "2026-04-27T00:00:02.000Z" } });
  store.applyRealtimeStatus({ type: "message_status_changed", conversation_id: "conversation-a", message_id: 101, snail_name: "Boss Snail", client_id: "temp-user-1", status: "completed", final_role: "user" });

  current = store.getState();
  assert(current.records.length === 1, "realtime lifecycle should keep a single user record after completion");
  assert(current.records[0].events.some((event: any) => event.kind === "text"), "upgraded record should receive realtime text event");
  assert(current.records[0].status === "completed", "record status should reflect message_status_changed");

  store.applyRealtimeEvent({ type: "message_event_appended", conversation_id: "conversation-b", message_id: 202, snail_name: "Implementation Snail", event: { id: 3, message_id: 202, seq: 1, category: "error", kind: "error", payload: { source: "runtime", message: "wrong conversation", detail: null }, source: {}, created_at: "2026-04-27T00:00:03.000Z" } });
  current = store.getState();
  assert(current.records.length === 1, "realtime events from another conversation must not create records in the active store");

  store.applyRealtimeStatus({ type: "message_status_changed", conversation_id: "conversation-a", message_id: 404, snail_name: "Implementation Snail", status: "completed", final_role: "assistant" });
  current = store.getState();
  assert(current.records.length === 1, "orphan realtime status must not create a message without content");

  store.replaceHistory("conversation-b", [{ id: 202, conversation_id: "conversation-b", role: "assistant", from_snail: "Implementation Snail", created_at: "2026-04-27T00:00:03.000Z", status: "failed", events: [] }]);
  current = store.getState();
  assert(current.records.length === 1 && current.records[0].id === 101, "late history from another conversation must not replace the active store");

  const backgroundStore = createMessageStore();
  backgroundStore.reset("conversation-b");
  backgroundStore.applyRealtimeStart({ type: "message_started", conversation_id: "conversation-b", message_id: 202, status: "streaming", snail_name: "Implementation Snail", role: "assistant" });
  backgroundStore.applyRealtimeEvent({ type: "message_event_appended", conversation_id: "conversation-b", message_id: 202, snail_name: "Implementation Snail", event: { id: 4, message_id: 202, seq: 1, category: "signal", kind: "start", payload: { role: "assistant", snail_name: "Implementation Snail", runtime: "opencode" }, source: {}, created_at: "2026-04-27T00:00:04.000Z" } });
  const background = backgroundStore.getState();
  assert(background.records.length === 1 && background.records[0].id === 202, "a separate background conversation store should accept its own realtime events");
  assert(store.getState().records.length === 1 && store.getState().records[0].id === 101, "background conversation updates must not mutate the active conversation store");
  assert(background.records[0].role === "assistant" && ["thinking", "streaming"].includes(background.records[0].statusView), "active assistant records should expose running status for composer gating");

  const lateJoinStore = createMessageStore();
  lateJoinStore.reset("conversation-c");
  lateJoinStore.replaceHistory("conversation-c", [{ id: 302, conversation_id: "conversation-c", role: "user", from_snail: "Boss Snail", created_at: "2026-04-27T00:00:04.000Z", status: "completed", events: [] }]);
  lateJoinStore.applyRealtimeEvent({ type: "message_event_appended", conversation_id: "conversation-c", message_id: 303, snail_name: "Implementation Snail", event: { id: 6, message_id: 303, seq: 1, category: "signal", kind: "start", payload: { role: "assistant", snail_name: "Implementation Snail", runtime: "opencode" }, source: {}, created_at: "2026-04-27T00:00:05.000Z" } });
  lateJoinStore.applyRealtimeEvent({ type: "message_event_appended", conversation_id: "conversation-c", message_id: 303, snail_name: "Implementation Snail", event: { id: 7, message_id: 303, seq: 2, category: "content", kind: "text", payload: { text: "late stream", mentions: [] }, source: {}, created_at: "2026-04-27T00:00:06.000Z" } });
  const lateJoin = lateJoinStore.getState();
  assert(lateJoin.records.length === 2 && lateJoin.records.some((record: any) => record.id === 303), "late websocket join should recover a message from its start event");
  assert(lateJoin.records.find((record: any) => record.id === 303).events.some((event: any) => event.kind === "text"), "recovered late-join message should accept subsequent realtime events");

  const missedStartStore = createMessageStore();
  missedStartStore.reset("conversation-d");
  missedStartStore.replaceHistory("conversation-d", [{ id: 403, conversation_id: "conversation-d", role: "user", from_snail: "Boss Snail", created_at: "2026-04-27T00:00:06.000Z", status: "completed", events: [] }]);
  missedStartStore.applyRealtimeEvent({ type: "message_event_appended", conversation_id: "conversation-d", message_id: 404, snail_name: "Implementation Snail", event: { id: 8, message_id: 404, seq: 2, category: "content", kind: "text", payload: { text: "first visible event", mentions: [] }, source: {}, created_at: "2026-04-27T00:00:07.000Z" } });
  const missedStart = missedStartStore.getState();
  assert(missedStart.records.length === 2 && missedStart.records.some((record: any) => record.id === 404), "late websocket join should recover a message even when start event was missed");
  assert(missedStart.records.find((record: any) => record.id === 404).role === "assistant", "recovered assistant message should derive role from snail context when start was missed");
  assert(missedStart.records.find((record: any) => record.id === 404).events.some((event: any) => event.kind === "text"), "message recovered after missing start should include the first visible realtime event");

  const oldHistoryStore = createMessageStore();
  oldHistoryStore.reset("conversation-e");
  oldHistoryStore.replaceHistory("conversation-e", [{ id: 500, conversation_id: "conversation-e", role: "user", from_snail: "Boss Snail", created_at: "2026-04-27T00:00:08.000Z", status: "completed", events: [] }]);
  oldHistoryStore.applyRealtimeEvent({ type: "message_event_appended", conversation_id: "conversation-e", message_id: 499, snail_name: "Implementation Snail", event: { id: 9, message_id: 499, seq: 2, category: "content", kind: "text", payload: { text: "old history", mentions: [] }, source: {}, created_at: "2026-04-27T00:00:07.000Z" } });
  assert(oldHistoryStore.getState().records.length === 1, "realtime recovery must not reintroduce messages older than the loaded history watermark");
  console.log("message-store tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
