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
  testSignalOnlyStreamFails();
  await testEmptyPromptFailsBeforeCliSpawn();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
