import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

class FakeElement {
  innerHTML = "";
  readonly children: FakeElement[] = [];
  className = "";

  appendChild(child: FakeElement): void {
    this.children.push(child);
  }
}

async function main(): Promise<void> {
  (globalThis as any).document = { createElement: () => new FakeElement() };
  const modulePath = path.resolve(__dirname, "../../src/web/dispatch-state-view.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ renderDispatchState: (target: FakeElement, dispatchState: any, currentConversation: any, escapeHtml: (value: string) => string, options?: any) => void }>;
  const { renderDispatchState } = await dynamicImport(moduleUrl);
  const dispatchState = {
    inbox_groups: [
      { to_snail: "Owner Snail", status: "claimed", forced_wrap_up_count: 1, dispatch_ids: [1, 2], message_ids: [10], latest_dispatch_at: "2026-05-05T00:00:00.000Z", messages: [{ message_id: 10, from_snail: "Boss Snail", role: "user", preview: "请处理一个非常非常长的问题，它应该在主看板里被截断而不是完整堆积到界面里", created_at: "2026-05-05T00:00:00.000Z" }] },
      { to_snail: "Product Snail", status: "pending", forced_wrap_up_count: 0, dispatch_ids: [3], message_ids: [11], latest_dispatch_at: "2026-05-05T00:01:00.000Z", messages: [] },
    ],
  };
  const diagnosticTarget = new FakeElement();
  const boardTarget = new FakeElement();

  renderDispatchState(diagnosticTarget, dispatchState, { id: "conversation-a" }, (value) => String(value), { mode: "diagnostic" });
  renderDispatchState(boardTarget, dispatchState, { id: "conversation-a" }, (value) => String(value), { mode: "board" });

  const diagnosticRendered = diagnosticTarget.children.map((child) => child.innerHTML).join("\n");
  const boardRendered = boardTarget.innerHTML;
  assert(diagnosticRendered.includes("Owner Snail"), "diagnostic dispatch state should render the to_snail field");
  assert(!diagnosticRendered.includes("未知 Snail"), "known to_snail should not fall back to an unknown label");
  assert(diagnosticRendered.includes("消费中") && diagnosticRendered.includes("目标 Snail 已读取 inbox"), "claimed dispatches should be described as active consumer work");
  assert(diagnosticRendered.includes("收口 1"), "forced wrap-up dispatch count should be visible in diagnostics");
  assert(boardRendered.includes("消息总线") && boardRendered.includes("生成和消费已解耦"), "board should explain the bus model in the main workspace");
  assert(boardRendered.includes("Boss Snail") && boardRendered.includes("Owner Snail"), "board should render a compact source-to-target lane");
  assert(boardRendered.includes("消费中") && boardRendered.includes("待消费"), "board should expose active and waiting flow states");
  assert(boardRendered.includes("收口 1"), "board should surface forced wrap-up flow without full diagnostic detail");

  console.log("dispatch-state-view tests passed");
}

main().catch((error) => {
  throw error;
});
