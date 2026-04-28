import { consumeGeminiOutput, finalizeGeminiReply, flushGeminiOutput } from "../../src/agent/gemini";
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

function collect(output: string): { events: AgentEvent[]; reply: string; sessionId: string | null } {
  const state = createState();
  const events: AgentEvent[] = [];
  consumeGeminiOutput(state, output, (event) => events.push(event));
  flushGeminiOutput(state, (event) => events.push(event));
  return {
    events,
    reply: finalizeGeminiReply(state),
    sessionId: state.sessionId,
  };
}

function testTextReply(): void {
  const sample = [
    '{"type":"init","sessionID":"ses_1"}',
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"Hello"}}',
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":" world"}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.reply === "Hello world", "text reply should be parsed from text events");
  assert(result.events.some((event: any) => event.type === "message_event" && event.event.kind === "text" && event.event.payload.text === "Hello"), "first text event should be emitted");
  assert(result.events.some((event: any) => event.type === "message_event" && event.event.kind === "text" && event.event.payload.text === " world"), "second text event should be emitted");
  assert(result.sessionId === "ses_1", "sessionId should be extracted from init event");
}

function testToolUseReply(): void {
  const sample = [
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"Reading file."}}',
    '{"type":"tool_use","sessionID":"ses_1","part":{"type":"tool","tool":"read","callID":"call_1","state":{"status":"completed","input":{"filePath":"/tmp/test.txt"}}}}',
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"Done."}}',
  ].join("\n");

  const result = collect(sample);
  const toolEvent: any = result.events.find((event: any) => event.type === "message_event" && event.event.kind === "tool_call");
  assert(toolEvent?.type === "message_event", "tool call event should be emitted");
  assert(toolEvent?.event.payload.tool_name === "read", "tool use name should come from part.tool");
  assert(toolEvent?.event.payload.call_id === "call_1", "tool use id should come from part.callID");
  assert(toolEvent?.event.payload.input.filePath === "/tmp/test.txt", "tool use input should come from part.state.input");
  assert(result.reply === "Reading file.Done.", "reply should join text chunks in order");
}

function testToolError(): void {
  const sample = [
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"Attempting read."}}',
    '{"type":"tool_use","sessionID":"ses_1","part":{"type":"tool","tool":"read","callID":"call_2","state":{"status":"error","input":{"filePath":"/tmp/test.txt"},"error":"file not found"}}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.events.some((event: any) => event.type === "message_event" && event.event.kind === "error" && event.event.payload.message === "file not found"), "tool error should be emitted");
  assert(result.reply === "Attempting read.", "reply should preserve text content before error");
}

function testStepFinishError(): void {
  const sample = [
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"Working."}}',
    '{"type":"step_finish","sessionID":"ses_1","part":{"type":"step-finish","state":{"status":"error","error":"timeout exceeded"}}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.events.some((event: any) => event.type === "message_event" && event.event.kind === "error" && event.event.payload.message === "timeout exceeded"), "step_finish error should be emitted");
}

function testInvalidJSON(): void {
  const sample = [
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"Valid"}}',
    'invalid json line',
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"More valid"}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.reply === "ValidMore valid", "invalid JSON lines should be skipped");
  assert(result.events.filter((event: any) => event.type === "message_event" && event.event.kind === "text").length === 2, "only valid text events should be emitted");
}

function testSessionIdExtraction(): void {
  const sample = [
    '{"type":"init","sessionID":"ses_abc123"}',
    '{"type":"text","sessionID":"ses_abc123","part":{"type":"text","text":"Test"}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.sessionId === "ses_abc123", "sessionId should be extracted from top-level sessionID field");
}

testTextReply();
testToolUseReply();
testToolError();
testStepFinishError();
testInvalidJSON();
testSessionIdExtraction();
