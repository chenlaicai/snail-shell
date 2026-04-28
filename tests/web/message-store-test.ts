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

  store.addOptimisticMessage({ clientId: "temp-user-1", role: "user", from_snail: "Boss Snail", quoted_message_id: null, quoted_message: null, created_at: "2026-04-27T00:00:00.000Z", events: [{ kind: "text", payload: { text: "hi", mentions: [] } }] });
  store.applyRealtimeStart({ type: "message_started", message_id: 101, status: "streaming", snail_name: "Boss Snail", role: "user", client_id: "temp-user-1" });

  let current = store.getState();
  assert(current.records.length === 1, "realtime start should upgrade optimistic user message instead of duplicating it");
  assert(current.records[0].id === 101, "upgraded record should carry persisted message id");
  assert(current.records[0].key === "message:101", "upgraded record should use persisted message key");
  assert(current.records[0].optimistic === false, "upgraded record should no longer be optimistic");

  store.applyRealtimeEvent({ type: "message_event_appended", message_id: 101, snail_name: "Boss Snail", client_id: "temp-user-1", event: { id: 1, message_id: 101, seq: 1, category: "signal", kind: "start", payload: { role: "user", snail_name: "Boss Snail", runtime: "system" }, source: {}, created_at: "2026-04-27T00:00:01.000Z" } });
  store.applyRealtimeEvent({ type: "message_event_appended", message_id: 101, snail_name: "Boss Snail", client_id: "temp-user-1", event: { id: 2, message_id: 101, seq: 2, category: "content", kind: "text", payload: { text: "hi", mentions: [] }, source: {}, created_at: "2026-04-27T00:00:02.000Z" } });
  store.applyRealtimeStatus({ type: "message_status_changed", message_id: 101, snail_name: "Boss Snail", client_id: "temp-user-1", status: "completed", final_role: "user" });

  current = store.getState();
  assert(current.records.length === 1, "realtime lifecycle should keep a single user record after completion");
  assert(current.records[0].events.some((event: any) => event.kind === "text"), "upgraded record should receive realtime text event");
  assert(current.records[0].status === "completed", "record status should reflect message_status_changed");
  console.log("message-store tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
