import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/realtime-guard.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ isCurrentConversationEvent: (message: any, socketConversationId: string, currentConversationId: string | null) => boolean }>;
  const { isCurrentConversationEvent } = await dynamicImport(moduleUrl);

  assert(isCurrentConversationEvent({ type: "agent_event", conversation_id: "conv-a", event: { type: "message_event_appended", conversation_id: "conv-a" } }, "conv-a", "conv-a"), "matching conversation event should be accepted");
  assert(!isCurrentConversationEvent({ type: "agent_event", conversation_id: "conv-old", event: { type: "message_event_appended", conversation_id: "conv-old" } }, "conv-old", "conv-new"), "events from an old socket should be ignored after switching conversations");
  assert(!isCurrentConversationEvent({ type: "agent_event", conversation_id: "conv-b", event: { type: "message_event_appended", conversation_id: "conv-b" } }, "conv-a", "conv-a"), "events labeled for another conversation should be ignored");
  assert(!isCurrentConversationEvent({ type: "agent_event", event: { type: "message_event_appended" } }, "conv-a", null), "events should be ignored when there is no active conversation");
  assert(isCurrentConversationEvent({ type: "agent_event", event: { type: "message_event_appended" } }, "conv-a", "conv-a"), "legacy events without conversation_id should still be accepted on the active socket");

  console.log("realtime-guard tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
