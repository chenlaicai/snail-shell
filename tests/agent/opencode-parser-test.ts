import { consumeOpenCodeOutput, finalizeOpenCodeReply, flushOpenCodeOutput } from "../../src/agent/opencode";
import type { AgentEvent } from "../../src/agent/interface";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createState() {
  return {
    buffer: "",
    rawOutput: [],
    textChunks: [],
    finalText: null,
    messageEventCount: 0,
    sessionId: null,
  };
}

function collect(output: string): { events: AgentEvent[]; reply: string } {
  const state = createState();
  const events: AgentEvent[] = [];
  consumeOpenCodeOutput(state, output, (event) => events.push(event));
  flushOpenCodeOutput(state, (event) => events.push(event));
  return {
    events,
    reply: finalizeOpenCodeReply(state),
  };
}

function testTextReply(): void {
  const sample = [
    '{"type":"step_start","timestamp":1,"sessionID":"ses_1","part":{"type":"step-start"}}',
    '{"type":"text","timestamp":2,"sessionID":"ses_1","part":{"type":"text","text":"HI"}}',
    '{"type":"step_finish","timestamp":3,"sessionID":"ses_1","part":{"type":"step-finish","reason":"stop"}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.reply === "HI", "text reply should be parsed from text events");
  assert(result.events.some((event: any) => event.type === "message_event" && event.event.kind === "text" && event.event.payload.text === "HI"), "text event should be emitted");
  assert(!result.events.some((event: any) => event.type === "message_event" && event.event.kind === "signal" && event.event.payload.type === "message_completed"), "parser should leave terminal message_completed to orchestration layer");
}

function testToolUseReply(): void {
  const sample = [
    '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"type":"text","text":"Reading now."}}',
    '{"type":"tool_use","timestamp":2,"sessionID":"ses_1","part":{"type":"tool","tool":"read","callID":"call_1","state":{"status":"completed","input":{"filePath":"/tmp/a.txt","offset":1}}}}',
    '{"type":"text","timestamp":3,"sessionID":"ses_1","part":{"type":"text","text":"done"}}',
  ].join("\n");

  const result = collect(sample);
  const toolEvent: any = result.events.find((event: any) => event.type === "message_event" && event.event.kind === "tool_call");
  assert(toolEvent?.type === "message_event", "tool call event should be emitted");
  assert(toolEvent?.event.payload.tool_name === "read", "tool use name should come from part.tool");
  assert(toolEvent?.event.payload.input.filePath === "/tmp/a.txt", "tool use input should come from part.state.input");
  assert(result.reply === "Reading now.done", "reply should join text chunks in order");
}

function testToolError(): void {
  const sample = [
    '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"type":"text","text":"Trying."}}',
    '{"type":"tool_use","timestamp":2,"sessionID":"ses_1","part":{"type":"tool","tool":"read","callID":"call_1","state":{"status":"error","input":{"filePath":"/tmp/a.txt"},"error":"permission denied"}}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.events.some((event: any) => event.type === "message_event" && event.event.kind === "error" && event.event.payload.message === "permission denied"), "tool error should be emitted");
  assert(result.reply === "Trying.", "reply should still preserve text content before the error");
}

function testToolResultWithoutTextIsSuccessfulEventStream(): void {
  const sample = JSON.stringify({
    type: "tool_use",
    timestamp: 1,
    sessionID: "ses_1",
    part: {
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: {
        status: "completed",
        input: { command: "message-out" },
        output: JSON.stringify({ format: "blocks", blocks: [{ type: "text", text: "done" }] }),
      },
    },
  });

  const result = collect(sample);
  assert(result.reply === "", "tool-result-only streams should not synthesize reply text");
  assert(result.events.some((event: any) => event.type === "message_event" && event.event.kind === "tool_result"), "tool result event should be emitted without text chunks");
}

testTextReply();
testToolUseReply();
testToolError();
testToolResultWithoutTextIsSuccessfulEventStream();
