import { consumeCodexOutput, flushCodexOutput, finalizeCodexReply, type CodexParseState } from "../../src/agent/codex";
import type { AgentEvent } from "../../src/agent/interface";

function createTestState(): CodexParseState {
  return { buffer: "", rawOutput: [], textChunks: [], messageEventCount: 0, threadId: null, completed: false, failed: false };
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function testThreadStarted(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  consumeCodexOutput(state, '{"type":"thread.started","thread_id":"test-thread-123"}\n', (event) => events.push(event));
  assert(state.threadId === "test-thread-123", "thread id should be captured");
  assert(events.length === 0, "thread.started should not enter message stream");
}

function testTurnStarted(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  consumeCodexOutput(state, '{"type":"turn.started"}\n', (event) => events.push(event));
  assert(events[0].type === "message_event" && events[0].event.kind === "signal" && events[0].event.payload.type === "turn_started", "turn.started should map to turn_started signal");
}

function testMessageCompletedEvent(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  consumeCodexOutput(state, JSON.stringify({ type: "turn.completed", message: { role: "assistant", content: [{ type: "text", text: "Hello, " }, { type: "text", text: "world!" }] } }) + "\n", (event) => events.push(event));
  assert(state.completed, "state should be completed");
  assert(state.textChunks.join("") === "Hello, world!", "text chunks should be accumulated");
  assert(events.filter((event) => event.type === "message_event" && event.event.kind === "text").length === 2, "turn.completed should emit text events");
  assert(events.some((event) => event.type === "message_event" && event.event.kind === "signal" && event.event.payload.type === "turn_completed"), "turn.completed signal should be emitted");
  assert(!events.some((event) => event.type === "message_event" && event.event.kind === "signal" && event.event.payload.type === "message_completed"), "parser should leave terminal message_completed to orchestration layer");
}

function testMessageFailedEvent(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  consumeCodexOutput(state, JSON.stringify({ type: "turn.failed", error: { message: "Something went wrong" } }) + "\n", (event) => events.push(event));
  assert(state.failed, "state should be failed");
  assert(events[0].type === "message_event" && events[0].event.kind === "error" && events[0].event.payload.message === "Something went wrong", "turn.failed should emit error event");
  assert(events[1].type === "message_failure" && events[1].error === "Something went wrong", "turn.failed should emit message_failure");
}

function testErrorEventDoesNotEmitFailure(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  consumeCodexOutput(state, JSON.stringify({ type: "error", message: "API error occurred" }) + "\n", (event) => events.push(event));
  assert(events.length === 1, "error event should emit one message event");
  assert(events[0].type === "message_event" && events[0].event.kind === "error", "error should map to error event");
  assert(!events.some((event) => event.type === "message_failure"), "error observation should not emit message_failure");
}

function testBufferingAndFlush(): void {
  const state = createTestState();
  consumeCodexOutput(state, '{"type":"thread.st', () => {});
  assert(state.threadId === null, "incomplete JSON should not parse");
  consumeCodexOutput(state, 'arted","thread_id":"abc"}\n', () => {});
  assert(state.threadId === "abc", "completed buffered JSON should parse");
  const flushState = createTestState();
  consumeCodexOutput(flushState, '{"type":"thread.started","thread_id":"xyz"}', () => {});
  flushCodexOutput(flushState, () => {});
  assert(flushState.threadId === "xyz", "flush should process buffered JSON");
}

function testFinalizeReply(): void {
  const state = createTestState();
  state.textChunks = ["Hello", " world"];
  state.messageEventCount = 2;
  assert(finalizeCodexReply(state) === "Hello world", "final reply should join chunks");
}

function testFinalizeAllowsNonTextEvents(): void {
  const state = createTestState();
  state.messageEventCount = 1;
  assert(finalizeCodexReply(state) === "", "non-text event streams should not synthesize reply text");
}

testThreadStarted();
testTurnStarted();
testMessageCompletedEvent();
testMessageFailedEvent();
testErrorEventDoesNotEmitFailure();
testBufferingAndFlush();
testFinalizeReply();
testFinalizeAllowsNonTextEvents();
console.log("codex parser tests passed");
