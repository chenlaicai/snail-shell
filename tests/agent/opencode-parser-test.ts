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
  assert(result.events.some((event: any) => event.type === "message_delta" && event.part.payload.kind === "text" && event.part.payload.text === "HI"), "text delta should be emitted");
}

function testToolUseReply(): void {
  const sample = [
    '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"type":"text","text":"Reading now."}}',
    '{"type":"tool_use","timestamp":2,"sessionID":"ses_1","part":{"type":"tool","tool":"read","callID":"call_1","state":{"status":"completed","input":{"filePath":"/tmp/a.txt","offset":1}}}}',
    '{"type":"text","timestamp":3,"sessionID":"ses_1","part":{"type":"text","text":"done"}}',
  ].join("\n");

  const result = collect(sample);
  const toolEvent: any = result.events.find((event: any) => event.type === "message_delta" && event.part.payload.kind === "tool_call");
  assert(toolEvent?.type === "message_delta", "tool call delta should be emitted");
  assert(toolEvent?.part.payload.tool_name === "read", "tool use name should come from part.tool");
  assert(toolEvent?.part.payload.input.filePath === "/tmp/a.txt", "tool use input should come from part.state.input");
  assert(result.reply === "Reading now.done", "reply should join text chunks in order");
}

function testToolError(): void {
  const sample = [
    '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"type":"text","text":"Trying."}}',
    '{"type":"tool_use","timestamp":2,"sessionID":"ses_1","part":{"type":"tool","tool":"read","callID":"call_1","state":{"status":"error","input":{"filePath":"/tmp/a.txt"},"error":"permission denied"}}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.events.some((event: any) => event.type === "message_delta" && event.part.payload.kind === "error_observation" && event.part.payload.error_text === "permission denied"), "tool error should be emitted");
  assert(result.reply === "Trying.", "reply should still preserve text content before the error");
}

testTextReply();
testToolUseReply();
testToolError();
