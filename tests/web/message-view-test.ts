import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function importWebModule<T>(relativePath: string): Promise<T> {
  const modulePath = path.resolve(__dirname, relativePath);
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<T>;
  return dynamicImport(moduleUrl);
}

async function main(): Promise<void> {
  const { buildMessageView, summarizeRecord } = await importWebModule<{ buildMessageView: (record: any, lookupById: Map<number, any>) => any; summarizeRecord: (record: any) => string }>("../../src/web/message-view.js");

  const record = {
    id: 42,
    key: "message:42",
    role: "assistant",
    from_snail: "Owner Snail",
    created_at: "2026-04-27T00:00:00.000Z",
    statusView: "completed",
    events: [
      { kind: "start", payload: { role: "assistant", snail_name: "Owner Snail", runtime: "opencode" } },
      { kind: "tool_call", payload: { tool_name: "Read", input: { filePath: "src/index.ts" } } },
      { kind: "text", payload: { text: "先看入口。", mentions: [] } },
      { kind: "command", payload: { command: "npm test" } },
      { kind: "command_result", payload: { command: "npm test", output_text: `第一行\n${"x".repeat(5000)}`, exit_code: 0, is_error: false } },
      { kind: "content_block", payload: { fallback_text: "结论", blocks: [{ type: "markdown", text: "# 结论" }] } },
    ],
  };

  const view = buildMessageView(record, new Map());
  const kinds = view.blocks.map((block: any) => block.kind);
  assert(kinds.join(",") === "event_log,text_event,event_log,markdown", `message should preserve event order while folding consecutive activity events, got ${kinds.join(",")}`);
  assert(view.blocks[0].items.length === 1, "first event log should contain activity events before the text event");
  assert(view.blocks[0].items[0].label.includes("[tool] Read"), "tool_call should render as an event log row");
  assert(view.blocks[1].text === "先看入口。", "text event should render as an event text block");
  assert(view.blocks[2].items.length === 2, "second event log should contain consecutive activity events after the text event");
  assert(view.blocks[2].items[0].label === "[command] npm test", "command should render after the text event");
  assert(view.blocks[2].items[1].label === "[command-result] npm test: 第一行", "command_result row should show an inline summary");
  assert(view.blocks[2].items[1].detail === `第一行\n${"x".repeat(5000)}`, "command_result detail should preserve full output without fixed truncation");
  assert(view.blocks[3].text === "# 结论", "content_block markdown should render after the second event log");
  assert(summarizeRecord(record) === "先看入口。", "record summary should still prefer conversational text events");

  console.log("message-view tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
