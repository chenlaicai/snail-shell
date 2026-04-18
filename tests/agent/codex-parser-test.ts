import { consumeCodexOutput, flushCodexOutput, finalizeCodexReply } from "../../src/agent/codex";
import type { AgentEvent } from "../../src/agent/interface";
import type { CodexParseState } from "../../src/agent/codex";

function createTestState(): CodexParseState {
  return {
    buffer: "",
    rawOutput: [],
    textChunks: [],
    threadId: null,
    completed: false,
    failed: false,
  };
}

function testThreadStarted(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  const onEvent = (event: AgentEvent) => events.push(event);

  const input = '{"type":"thread.started","thread_id":"test-thread-123"}\n';
  consumeCodexOutput(state, input, onEvent);

  if (state.threadId !== "test-thread-123") {
    throw new Error(`Expected threadId to be "test-thread-123", got ${state.threadId}`);
  }
  if (events.length !== 0) {
    throw new Error(`Expected no events, got ${events.length}`);
  }
  console.log("✓ testThreadStarted passed");
}

function testTurnCompleted(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  const onEvent = (event: AgentEvent) => events.push(event);

  const input = JSON.stringify({
    type: "turn.completed",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Hello, " },
        { type: "text", text: "world!" },
      ],
    },
  }) + "\n";

  consumeCodexOutput(state, input, onEvent);

  if (!state.completed) {
    throw new Error("Expected state.completed to be true");
  }
  if (state.textChunks.length !== 2) {
    throw new Error(`Expected 2 text chunks, got ${state.textChunks.length}`);
  }
  if (state.textChunks.join("") !== "Hello, world!") {
    throw new Error(`Expected "Hello, world!", got "${state.textChunks.join("")}"`);
  }
  if (events.length !== 2) {
    throw new Error(`Expected 2 events, got ${events.length}`);
  }
  if (events[0].type !== "streaming_chunk" || events[0].content !== "Hello, ") {
    throw new Error("First event should be streaming_chunk with 'Hello, '");
  }
  if (events[1].type !== "streaming_chunk" || events[1].content !== "world!") {
    throw new Error("Second event should be streaming_chunk with 'world!'");
  }
  console.log("✓ testTurnCompleted passed");
}

function testTurnFailed(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  const onEvent = (event: AgentEvent) => events.push(event);

  const input = JSON.stringify({
    type: "turn.failed",
    error: {
      message: "Something went wrong",
    },
  }) + "\n";

  consumeCodexOutput(state, input, onEvent);

  if (!state.failed) {
    throw new Error("Expected state.failed to be true");
  }
  if (events.length !== 1) {
    throw new Error(`Expected 1 event, got ${events.length}`);
  }
  if (events[0].type !== "error" || events[0].error !== "Something went wrong") {
    throw new Error("Expected error event with message");
  }
  console.log("✓ testTurnFailed passed");
}

function testErrorEvent(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  const onEvent = (event: AgentEvent) => events.push(event);

  const input = JSON.stringify({
    type: "error",
    message: "API error occurred",
  }) + "\n";

  consumeCodexOutput(state, input, onEvent);

  if (events.length !== 1) {
    throw new Error(`Expected 1 event, got ${events.length}`);
  }
  if (events[0].type !== "error" || events[0].error !== "API error occurred") {
    throw new Error("Expected error event with message");
  }
  console.log("✓ testErrorEvent passed");
}

function testBuffering(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  const onEvent = (event: AgentEvent) => events.push(event);

  // Send partial JSON
  consumeCodexOutput(state, '{"type":"thread.st', onEvent);
  if (state.threadId !== null) {
    throw new Error("Should not parse incomplete JSON");
  }

  // Complete the JSON
  consumeCodexOutput(state, 'arted","thread_id":"abc"}\n', onEvent);
  if (state.threadId !== "abc") {
    throw new Error(`Expected threadId "abc", got ${state.threadId}`);
  }

  console.log("✓ testBuffering passed");
}

function testFlush(): void {
  const state = createTestState();
  const events: AgentEvent[] = [];
  const onEvent = (event: AgentEvent) => events.push(event);

  // Send JSON without newline
  consumeCodexOutput(state, '{"type":"thread.started","thread_id":"xyz"}', onEvent);
  if (state.threadId !== null) {
    throw new Error("Should not parse without newline");
  }

  // Flush should process the buffer
  flushCodexOutput(state, onEvent);
  if (state.threadId !== "xyz") {
    throw new Error(`Expected threadId "xyz", got ${state.threadId}`);
  }

  console.log("✓ testFlush passed");
}

function testFinalizeReply(): void {
  const state = createTestState();
  state.textChunks.push("Hello");
  state.textChunks.push(" ");
  state.textChunks.push("world");

  const reply = finalizeCodexReply(state);
  if (reply !== "Hello world") {
    throw new Error(`Expected "Hello world", got "${reply}"`);
  }

  console.log("✓ testFinalizeReply passed");
}

function testFinalizeEmptyReply(): void {
  const state = createTestState();

  try {
    finalizeCodexReply(state);
    throw new Error("Should throw error for empty reply");
  } catch (error) {
    if (error instanceof Error && error.message.includes("no reply content")) {
      console.log("✓ testFinalizeEmptyReply passed");
    } else {
      throw error;
    }
  }
}

function runTests(): void {
  console.log("Running Codex parser tests...\n");

  testThreadStarted();
  testTurnCompleted();
  testTurnFailed();
  testErrorEvent();
  testBuffering();
  testFlush();
  testFinalizeReply();
  testFinalizeEmptyReply();

  console.log("\n✅ All Codex parser tests passed!");
}

runTests();
