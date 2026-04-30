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
  const longText = `正文开始\n${"t".repeat(5000)}`;
  const longCommandOutput = `第一行\n${"x".repeat(5000)}`;

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
      { kind: "text", payload: { text: longText, mentions: [] } },
      { kind: "command", payload: { command: "npm test" } },
      { kind: "command_result", payload: { command: "npm test", output_text: longCommandOutput, exit_code: 0, is_error: false } },
      { kind: "signal", payload: { type: "step_start" } },
      { kind: "signal", payload: { type: "step_finish", reason: "stop" } },
      { kind: "content_block", payload: { fallback_text: "结论", blocks: [{ type: "markdown", text: "# 结论" }] } },
      { kind: "signal", payload: { type: "message_completed" } },
    ],
  };

  const view = buildMessageView(record, new Map());
  const kinds = view.blocks.map((block: any) => block.kind);
  assert(kinds.join(",") === "event_activity,event_text,event_activity,event_activity,event_content_block", `message should render one top-level block per displayable event in persisted order, got ${kinds.join(",")}`);
  assert(!kinds.includes("event_log"), "activity events must not be merged into an event_log group");
  assert(view.blocks.length === 5, "start, step signals and message_completed are intentionally filtered lifecycle events");
  assert(view.blocks[0].eventKind === "tool_call" && view.blocks[0].defaultOpen === false, "tool_call should be an event block collapsed by default");
  assert(view.blocks[1].eventKind === "text" && view.blocks[1].defaultOpen === true, "text event should be an event block expanded by default");
  assert(view.blocks[1].bodyBlocks[0].kind === "text_event", "text event body should stay inside the event wrapper");
  assert(view.blocks[1].bodyBlocks[0].text === longText, "text event detail should preserve full text without fixed truncation");
  assert(view.blocks[2].eventKind === "command" && view.blocks[2].defaultOpen === false, "command should render after text and collapse by default");
  assert(view.blocks[3].eventKind === "command_result" && view.blocks[3].defaultOpen === false, "command_result should collapse by default");
  assert(view.blocks[3].detail === longCommandOutput, "command_result detail should preserve full output without fixed truncation");
  assert(view.blocks[4].eventKind === "content_block" && view.blocks[4].defaultOpen === true, "markdown content_block should be an event block expanded by default");
  assert(view.blocks[4].bodyBlocks[0].kind === "markdown" && view.blocks[4].bodyBlocks[0].text === "# 结论", "content_block markdown should stay in its original order position inside the event wrapper");
  assert(summarizeRecord(record) === longText.replace(/\s+/g, " ").trim(), "record summary should still prefer conversational text events");

  const contextView = buildMessageView({
    ...record,
    context: { message_id: 42, kind: "final_text", context: "最终上下文", updated_at: "2026-04-27T00:00:01.000Z" },
  }, new Map());
  assert(contextView.blocks[0].kind === "event_stream", "completed assistant final-text messages should show the stream process before final text");
  assert(contextView.blocks[0].summary === "流式过程", "completed assistant stream process should use the user-facing stream-process label");
  assert(contextView.blocks[0].defaultOpen === false, "completed assistant stream process should collapse by default");
  assert(contextView.blocks[0].blocks.some((block: any) => block.defaultOpen === true), "folded stream process should preserve each event default-open intent for manual expansion");
  assert(contextView.blocks[1].kind === "message_context", "completed assistant final text should render after the stream process");
  assert(summarizeRecord({ ...record, context: { message_id: 42, kind: "final_text", context: "最终上下文", updated_at: "2026-04-27T00:00:01.000Z" } }) === "最终上下文", "record summary should prefer message context when available");

  const questionRecord = {
    id: 43,
    key: "message:43",
    role: "assistant",
    statusView: "completed",
    events: [
      {
        kind: "content_block",
        payload: {
          fallback_text: "需要确认",
          blocks: [{
            type: "question",
            title: "请选择",
            question: "继续执行吗？",
            options: [{ key: "yes", label: "继续" }],
          }],
        },
      },
    ],
  };
  const questionView = buildMessageView(questionRecord, new Map());
  assert(questionView.blocks.length === 1, "question content_block should remain one persisted event block");
  assert(questionView.blocks[0].kind === "event_content_block", "question content_block should stay wrapped as an event block");
  assert(questionView.blocks[0].defaultOpen === true, "question content_block should default open so the form is visible");
  assert(questionView.blocks[0].containsQuestion === true, "question content_block should mark the message for question styling");
  assert(questionView.blocks[0].bodyBlocks[0].kind === "question", "question form should remain renderable inside the event body");

  const completedQuestionView = buildMessageView({
    ...questionRecord,
    context: { message_id: 43, kind: "final_text", context: "请先回答问题", updated_at: "2026-04-27T00:00:01.000Z" },
  }, new Map());
  assert(completedQuestionView.blocks[0].kind === "event_stream", "completed final-text question messages should still show the stream process first");
  assert(completedQuestionView.blocks[0].defaultOpen === true, "completed final-text question stream should default open so the form is visible");
  assert(completedQuestionView.blocks[0].containsQuestion === true, "completed final-text question stream should keep top-level question styling available");
  assert(completedQuestionView.blocks[0].blocks[0].defaultOpen === true, "completed final-text question inner event should default open so the form is visible");
  assert(completedQuestionView.blocks[0].blocks[0].containsQuestion === true, "completed final-text question inner event should carry the interactive marker through rendering");
  assert(completedQuestionView.blocks[0].blocks[0].bodyBlocks[0].kind === "question", "completed final-text question form should remain renderable inside the stream body");

  const streamingRecord = {
    id: 44,
    key: "message:44",
    role: "assistant",
    statusView: "streaming",
    events: [
      { kind: "text", payload: { text: "正在处理", mentions: [] } },
    ],
  };
  const streamingView = buildMessageView(streamingRecord, new Map());
  assert(streamingView.blocks[0].kind === "running_indicator", "streaming assistant messages should show a running indicator before streamed content");
  assert(streamingView.blocks[1].kind === "event_text", "streamed content should remain visible after the running indicator");

  const completedView = buildMessageView({ ...streamingRecord, statusView: "done" }, new Map());
  assert(!completedView.blocks.some((block: any) => block.kind === "running_indicator"), "completed assistant messages should not keep the running indicator");

  const interruptedView = buildMessageView({
    ...streamingRecord,
    statusView: "interrupted",
    events: [
      { kind: "text", payload: { text: "已输出部分内容", mentions: [] } },
      { kind: "signal", payload: { type: "message_interrupted", reason: null, detail: null } },
    ],
  }, new Map());
  assert(!interruptedView.blocks.some((block: any) => block.kind === "running_indicator"), "interrupted assistant messages should stop showing the running indicator");
  assert(interruptedView.blocks.some((block: any) => block.eventKind === "signal" && block.summary.includes("message_interrupted")), "interrupted assistant messages should expose the terminal interrupted signal in the event trace");

  const structuredJson = JSON.stringify({
    format: "blocks",
    fallback_text: "# 结论\n已处理",
    blocks: [{ type: "markdown", text: "# 结论\n已处理" }],
  });
  const structuredView = buildMessageView({
    id: 45,
    key: "message:45",
    role: "assistant",
    statusView: "done",
    events: [
      { kind: "text", payload: { text: structuredJson.slice(0, 20), mentions: [] } },
      { kind: "text", payload: { text: structuredJson.slice(20), mentions: [] } },
    ],
  }, new Map());
  assert(structuredView.blocks.length === 1, "chunked message-out JSON should render as one semantic block after completion");
  assert(structuredView.blocks[0].kind === "event_content_block", "message-out text should render as structured content instead of raw JSON");
  assert(structuredView.blocks[0].eventKind === "text", "message-out content should remain traceable to the original text event");
  assert(structuredView.blocks[0].bodyBlocks[0].kind === "markdown", "message-out markdown block should render as markdown");

  const longToolSummaryView = buildMessageView({
    id: 46,
    key: "message:46",
    role: "assistant",
    statusView: "done",
    events: [{ kind: "tool_call", payload: { tool_name: "Bash", input: { command: "x".repeat(500) } } }],
  }, new Map());
  assert(longToolSummaryView.blocks[0].summary.length <= 96, "tool call summary should be capped for collapsed details");

  const bossView = buildMessageView({
    id: 47,
    key: "message:47",
    role: "user",
    from_snail: "Boss Snail",
    statusView: "streaming",
    events: [{ kind: "start", payload: { role: "user", snail_name: "Boss Snail", runtime: "system" } }],
  }, new Map());
  assert(!bossView.blocks.some((block: any) => block.kind === "running_indicator"), "Boss Snail messages should not show assistant thinking UI");

  const quotedBossView = buildMessageView({
    id: 49,
    key: "message:49",
    role: "user",
    from_snail: "Boss Snail",
    quoted_message: { role: "assistant", from_snail: "Implementation Snail", preview: "上一条结论" },
    statusView: "completed",
    events: [{ kind: "text", payload: { text: "这条带引用的正文必须显示", mentions: [] } }],
  }, new Map());
  assert(quotedBossView.blocks[0].kind === "quote", "quoted Boss Snail messages should render the quote first");
  assert(quotedBossView.blocks[1].kind === "event_text", "quoted Boss Snail messages without final context should still render their body text after the quote");
  assert(quotedBossView.blocks[1].bodyBlocks[0].text === "这条带引用的正文必须显示", "quoted Boss Snail message body should not be hidden by the quote block");

  const bossCompletedView = buildMessageView({
    id: 48,
    key: "message:48",
    role: "user",
    from_snail: "Boss Snail",
    statusView: "completed",
    context: { message_id: 48, kind: "final_text", context: "最终文本", updated_at: "2026-04-27T00:00:01.000Z" },
    events: [{ kind: "text", payload: { text: "最终文本", mentions: [] } }],
  }, new Map());
  assert(bossCompletedView.blocks.length === 1, "Boss Snail completed messages should not duplicate final text with event traces");
  assert(bossCompletedView.blocks[0].kind === "message_context", "Boss Snail completed messages should prefer the final message body only");
  assert(!bossCompletedView.blocks.some((block: any) => block.kind === "event_text" || block.kind === "event_stream"), "Boss Snail messages should not expose a stream-process UI");

  console.log("message-view tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
