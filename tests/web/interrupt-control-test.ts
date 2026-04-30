import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

class FakeButton {
  hidden = false;
  disabled = false;
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(event: string, listener: () => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
}

async function importInterruptControl(): Promise<{ bindInterruptControl: (button: FakeButton, deps: any) => { sync: (conversationId?: string | null, runningMessage?: any) => void } }> {
  const modulePath = path.resolve(__dirname, "../../src/web/interrupt-control.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ bindInterruptControl: (button: FakeButton, deps: any) => { sync: (conversationId?: string | null, runningMessage?: any) => void } }>;
  return dynamicImport(moduleUrl);
}

async function main(): Promise<void> {
  const { bindInterruptControl } = await importInterruptControl();
  const button = new FakeButton();
  const apiCalls: string[] = [];
  const availabilitySyncs: string[] = [];
  const notices: string[] = [];
  let currentConversationId: string | null = "conversation-a";

  const control = bindInterruptControl(button, {
    api: async (_method: string, url: string) => {
      apiCalls.push(url);
      return { interrupted: true };
    },
    getConversationId: () => currentConversationId,
    isArchived: () => false,
    syncAvailability: (conversationId: string) => availabilitySyncs.push(conversationId),
    showNotice: (message: string) => notices.push(message),
  });

  control.sync("conversation-a", { id: 101 });
  assert(button.hidden === false, "running assistant message should show the interrupt button");
  assert(button.disabled === false, "visible interrupt button should be enabled before an interrupt is pending");

  button.click();
  await Promise.resolve();
  assert(button.disabled === true, "interrupting a running message should disable the button for that target");
  assert(apiCalls[0] === "/conversations/conversation-a/messages/101/interrupt", "interrupt should target the selected running assistant message");

  control.sync("conversation-a", { id: 202 });
  assert(button.hidden === false, "another running assistant message should keep the interrupt button visible");
  assert(button.disabled === false, "switching to a different running message should make the interrupt button available again");

  button.click();
  await Promise.resolve();
  assert(apiCalls[1] === "/conversations/conversation-a/messages/202/interrupt", "second interrupt should target the newly running assistant message");

  control.sync("conversation-a", null);
  assert(button.hidden === true, "without a running assistant message the interrupt button should be hidden");
  assert(button.disabled === false, "hiding the interrupt button should clear pending disabled state");

  currentConversationId = "conversation-b";
  control.sync("conversation-a", { id: 303 });
  assert(button.hidden === true, "stale conversation running messages must not expose the active interrupt button");
  assert(button.disabled === false, "stale conversation sync should not leave the interrupt button disabled");
  assert(availabilitySyncs.length === 0, "successful interrupts should rely on realtime status instead of forcing availability sync");
  assert(notices.length === 0, "successful interrupts should not show failure notices");

  console.log("interrupt-control tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
