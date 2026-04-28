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
  assert(kinds.join(",") === "event_activity,text_event,event_activity,event_activity,markdown", `message event blocks should preserve event order, got ${kinds.join(",")}`);
  assert(view.blocks[0].label.includes("[tool] Read"), "tool_call should render as an activity event block");
  assert(view.blocks[1].text === "先看入口。", "text event should render as an event text block");
  assert(view.blocks[2].label === "[command] npm test", "command should render in sequence before following content_block");
  assert(view.blocks[3].label === "[command-result] npm test: 第一行", "command_result should render an inline summary instead of full output");
  assert(view.blocks[3].detail.length < 4100, "command_result detail should be truncated before rendering");
  assert(view.blocks[3].detail.includes("chars truncated"), "truncated command_result detail should disclose truncation");
  assert(view.blocks[4].text === "# 结论", "content_block markdown should render in sequence");
  assert(summarizeRecord(record) === "先看入口。", "record summary should still prefer conversational text events");

  console.log("message-view tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
