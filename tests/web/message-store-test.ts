import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/message-store.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ createMessageStore: (onChange?: (() => void) | undefined) => any }>;
  const { createMessageStore } = await dynamicImport(moduleUrl);

  const store = createMessageStore();

  store.addOptimisticMessage({
    clientId: "temp-user-1",
    role: "user",
    from_snail: "Boss Snail",
    quoted_message_id: null,
    quoted_message: null,
    created_at: "2026-04-27T00:00:00.000Z",
    parts: [{
      kind: "result",
      payload: {
        format: "blocks",
        blocks: [{ type: "text", text: "hi" }],
        fallback_text: "hi",
      },
    }],
  });

  store.applyRealtimeStart({
    type: "message_start",
    message_id: 101,
    snail_name: "Boss Snail",
    role: "user",
    client_id: "temp-user-1",
  });

  let current = store.getState();
  assert(current.records.length === 1, "realtime start should upgrade optimistic user message instead of duplicating it");
  assert(current.records[0].id === 101, "upgraded record should carry persisted message id");
  assert(current.records[0].key === "message:101", "upgraded record should use persisted message key");
  assert(current.records[0].optimistic === false, "upgraded record should no longer be optimistic");

  store.applyRealtimePart({
    type: "message_part",
    message_id: 101,
    snail_name: "Boss Snail",
    client_id: "temp-user-1",
    part: {
      id: 1,
      message_id: 101,
      kind: "result",
      payload: {
        format: "blocks",
        blocks: [{ type: "text", text: "hi" }],
        fallback_text: "hi",
      },
      created_at: "2026-04-27T00:00:01.000Z",
    },
  });

  store.applyRealtimeEnd({
    type: "message_end",
    message_id: 101,
    snail_name: "Boss Snail",
    client_id: "temp-user-1",
    status: "success",
    final_role: "user",
  });

  current = store.getState();
  assert(current.records.length === 1, "realtime lifecycle should keep a single user record after completion");
  assert(current.records[0].parts.some((part: any) => part.kind === "end"), "upgraded record should receive realtime end part");

  console.log("message-store tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
