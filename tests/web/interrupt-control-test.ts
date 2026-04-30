import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function importInterruptControl(): Promise<{ createInterruptController: (deps: any) => any }> {
  const modulePath = path.resolve(__dirname, "../../src/web/interrupt-control.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ createInterruptController: (deps: any) => any }>;
  return dynamicImport(moduleUrl);
}

async function main(): Promise<void> {
  const { createInterruptController } = await importInterruptControl();
  const apiCalls: string[] = [];
  const availabilitySyncs: string[] = [];
  const notices: string[] = [];
  const control = createInterruptController({
    api: async (_method: string, url: string) => {
      apiCalls.push(url);
      return { interrupted: true };
    },
    isArchived: () => false,
    syncAvailability: (conversationId: string) => availabilitySyncs.push(conversationId),
    showNotice: (message: string) => notices.push(message),
  });

  assert(control.isPending({ conversationId: "conversation-a", messageId: 101 }) === false, "message-level interrupt should not start pending");
  const interruptPromise = control.interrupt({ conversationId: "conversation-a", messageId: 101 });
  assert(control.isPending({ conversationId: "conversation-a", messageId: 101 }) === true, "interrupt should be pending for the exact message target");
  assert(control.isPending({ conversationId: "conversation-a", messageId: 202 }) === false, "pending state must not bleed to another message");
  await control.interrupt({ conversationId: "conversation-a", messageId: 101 });
  assert(apiCalls.length === 1, "re-entering the same pending interrupt target must not send a duplicate request");
  await interruptPromise;
  assert(apiCalls[0] === "/conversations/conversation-a/messages/101/interrupt", "interrupt should call the message-level API");

  control.clearIfNot({ conversationId: "conversation-a", messageId: 101 });
  assert(control.isPending({ conversationId: "conversation-a", messageId: 101 }) === true, "same running message keeps pending state until realtime terminal status");
  control.clearIfNot({ conversationId: "conversation-a", messageId: 202 });
  assert(control.isPending({ conversationId: "conversation-a", messageId: 101 }) === false, "switching running message clears stale pending state");
  assert(availabilitySyncs.length === 0, "successful interrupts should rely on realtime status instead of forcing availability sync");
  assert(notices.length === 0, "successful interrupts should not show failure notices");

  console.log("interrupt-control tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
