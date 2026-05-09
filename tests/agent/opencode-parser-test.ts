import { collectOpenCodeText, consumeOpenCodeOutput, flushOpenCodeOutput, invokeOpenCodeForTest } from "../../src/agent/opencode";
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
    outputEventCount: 0,
    sessionId: null,
  };
}

function collect(output: string): { events: AgentEvent[]; text: string } {
  const state = createState();
  const events: AgentEvent[] = [];
  consumeOpenCodeOutput(state, output, (event) => events.push(event));
  flushOpenCodeOutput(state, (event) => events.push(event));
  return {
    events,
    text: collectOpenCodeText(state),
  };
}

function testTextReply(): void {
  const sample = [
    '{"type":"step_start","timestamp":1,"sessionID":"ses_1","part":{"type":"step-start"}}',
    '{"type":"text","timestamp":2,"sessionID":"ses_1","part":{"type":"text","text":"HI"}}',
    '{"type":"step_finish","timestamp":3,"sessionID":"ses_1","part":{"type":"step-finish","reason":"stop"}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.text === "HI", "text should be parsed from text events");
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
  assert(result.text === "Reading now.done", "text should join text chunks in order");
}

function testToolError(): void {
  const sample = [
    '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"type":"text","text":"Trying."}}',
    '{"type":"tool_use","timestamp":2,"sessionID":"ses_1","part":{"type":"tool","tool":"read","callID":"call_1","state":{"status":"error","input":{"filePath":"/tmp/a.txt"},"error":"permission denied"}}}',
  ].join("\n");

  const result = collect(sample);
  assert(result.events.some((event: any) => event.type === "message_event" && event.event.kind === "error" && event.event.payload.message === "permission denied"), "tool error should be emitted");
  assert(result.text === "Trying.", "text should still preserve text content before the error");
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
  assert(result.text === "", "tool-result-only streams should not synthesize text");
  assert(result.events.some((event: any) => event.type === "message_event" && event.event.kind === "tool_result"), "tool result event should be emitted without text chunks");
}

function testStepFinishUsageIsRecordedAsSignal(): void {
  const sample = [
    '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"type":"text","text":"ok"}}',
    JSON.stringify({
      type: "step_finish",
      timestamp: 2,
      sessionID: "ses_1",
      part: {
        type: "step-finish",
        reason: "stop",
        tokens: { total: 224106, input: 1024, output: 0, reasoning: 0, cache: { write: 0, read: 0 } },
      },
    }),
  ].join("\n");

  const result = collect(sample);
  const usageEvent: any = result.events.find((event: any) => event.type === "message_event" && event.event.kind === "signal" && event.event.payload.type === "runtime_usage");
  assert(usageEvent?.event.payload.reason === "zero_output_tokens", "zero output usage should be diagnosable");
  assert(usageEvent?.event.payload.detail.input_tokens === 1024, "input token count should be preserved");
  assert(usageEvent?.event.payload.detail.total_tokens === 224106, "total token count should be preserved");
  assert(usageEvent?.event.payload.detail.output_tokens === 0, "output token count should be preserved");
  assert(usageEvent?.event.payload.detail.context_window === 270000, "OpenCode custom model should use the built-in context window fallback");
  assert(usageEvent?.event.payload.detail.context_window_source === "builtin", "OpenCode fallback context window source should be explicit");
  assert(usageEvent?.event.payload.detail.context_usage_ratio === 224106 / 270000, "context usage ratio should prefer total_tokens over input_tokens");
}

function testInputOnlyUsageDoesNotPretendToBeContextUsage(): void {
  const sample = [
    '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"type":"text","text":"ok"}}',
    JSON.stringify({
      type: "step_finish",
      timestamp: 2,
      sessionID: "ses_1",
      part: {
        type: "step-finish",
        reason: "stop",
        tokens: { input: 1024 },
      },
    }),
  ].join("\n");

  const result = collect(sample);
  const usageEvent: any = result.events.find((event: any) => event.type === "message_event" && event.event.kind === "signal" && event.event.payload.type === "runtime_usage");
  assert(usageEvent?.event.payload.detail.input_tokens === 1024, "input-only usage should still preserve raw diagnostics");
  assert(usageEvent?.event.payload.detail.total_tokens === null, "input-only usage should not synthesize total tokens");
  assert(usageEvent?.event.payload.detail.context_usage_ratio === null, "input-only usage should not pretend to be current context usage");
}

function testSignalOnlyStreamFails(): void {
  let failed = false;
  try {
    collect([
      '{"type":"step_start","timestamp":1,"sessionID":"ses_1","part":{"type":"step-start"}}',
      '{"type":"step_finish","timestamp":2,"sessionID":"ses_1","part":{"type":"step-finish","reason":"stop"}}',
    ].join("\n"));
  } catch (error) {
    failed = error instanceof Error && error.message.includes("no output events");
  }
  assert(failed, "signal-only streams should not satisfy runtime success output boundary");
}

async function testEmptyPromptFailsBeforeCliSpawn(): Promise<void> {
  let failed = false;
  try {
    await invokeOpenCodeForTest({ sessionId: "existing-session", bootstrap: null, incrementalMessages: [] }, () => undefined);
  } catch (error) {
    failed = error instanceof Error && error.message === "OpenCode invocation prompt is empty";
  }
  assert(failed, "empty stateful prompt should fail with a Snail Shell runtime diagnostic before spawning CLI");
}

async function main(): Promise<void> {
  testTextReply();
  testToolUseReply();
  testToolError();
  testToolResultWithoutTextIsSuccessfulEventStream();
  testStepFinishUsageIsRecordedAsSignal();
  testInputOnlyUsageDoesNotPretendToBeContextUsage();
  testSignalOnlyStreamFails();
  await testEmptyPromptFailsBeforeCliSpawn();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
