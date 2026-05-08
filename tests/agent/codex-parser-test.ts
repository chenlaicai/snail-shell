import { collectCodexText, consumeCodexOutput, flushCodexOutput, type CodexParseState } from "../../src/agent/codex";
import type { AgentEvent } from "../../src/agent/interface";

function createTestState(): CodexParseState {
  return { buffer: "", rawOutput: [], textChunks: [], outputEventCount: 0, threadId: null, model: null, completed: false, failed: false };
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

function testTurnCompletedUsageIsRecordedAsSignal(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  consumeCodexOutput(state, JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 22516, cached_input_tokens: 13056, output_tokens: 186 },
    message: { role: "assistant", content: [{ type: "text", text: "done" }] },
  }) + "\n", (event) => events.push(event));
  const usageEvent: any = events.find((event: any) => event.type === "message_event" && event.event.kind === "signal" && event.event.payload.type === "runtime_usage");
  assert(usageEvent?.event.payload.detail.input_tokens === 22516, "Codex input tokens should be recorded");
  assert(usageEvent?.event.payload.detail.cached_input_tokens === 13056, "Codex cached input tokens should be recorded");
  assert(usageEvent?.event.payload.detail.output_tokens === 186, "Codex output tokens should be recorded");
}

function testInputOnlyUsageDoesNotPretendToBeContextUsage(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  consumeCodexOutput(state, JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 22516 },
    message: { role: "assistant", content: [{ type: "text", text: "done" }] },
  }) + "\n", (event) => events.push(event));
  const usageEvent: any = events.find((event: any) => event.type === "message_event" && event.event.kind === "signal" && event.event.payload.type === "runtime_usage");
  assert(usageEvent?.event.payload.detail.input_tokens === 22516, "Codex input-only usage should still preserve raw diagnostics");
  assert(usageEvent?.event.payload.detail.total_tokens === null, "Codex input-only usage should not synthesize total tokens");
  assert(usageEvent?.event.payload.detail.context_usage_ratio === null, "Codex input-only usage should not pretend to be current context usage");
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

function testCollectText(): void {
  const state = createTestState();
  state.textChunks = ["Hello", " world"];
  state.outputEventCount = 2;
  assert(collectCodexText(state) === "Hello world", "collected text should join chunks");
}

function testCollectTextAllowsNonTextEvents(): void {
  const state = createTestState();
  state.outputEventCount = 1;
  assert(collectCodexText(state) === "", "non-text event streams should not synthesize text");
}

function testSignalOnlyStreamFails(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  consumeCodexOutput(state, JSON.stringify({ type: "turn.started" }) + "\n", (event) => events.push(event));
  consumeCodexOutput(state, JSON.stringify({ type: "turn.completed", message: { role: "assistant", content: [] } }) + "\n", (event) => events.push(event));
  let failed = false;
  try {
    collectCodexText(state);
  } catch (error) {
    failed = error instanceof Error && error.message.includes("no output events");
  }
  assert(failed, "signal-only streams should not satisfy runtime success output boundary");
}

testThreadStarted();
testTurnStarted();
testMessageCompletedEvent();
testTurnCompletedUsageIsRecordedAsSignal();
testInputOnlyUsageDoesNotPretendToBeContextUsage();
testMessageFailedEvent();
testErrorEventDoesNotEmitFailure();
testBufferingAndFlush();
testCollectText();
testCollectTextAllowsNonTextEvents();
testSignalOnlyStreamFails();
console.log("codex parser tests passed");
