import { EventEmitter } from "events";
import { ClaudeCodeStatefulAgent } from "../../src/agent/claude-code-stateful";
import type { StatefulInvocationInput } from "../../src/agent/interface";
import type { ChildProcess } from "child_process";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function closeProcessSoon(proc: ChildProcess): void {
  setImmediate(() => proc.emit("close", 0, null));
}

class MockWritable extends EventEmitter {
  written: string[] = [];
  destroyed = false;

  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }

  end(): void {
    this.emit("finish");
  }
}

class MockReadable extends EventEmitter {
  pushLine(line: string): void {
    this.emit("data", Buffer.from(`${line}\n`, "utf8"));
  }

  finish(): void {
    this.emit("end");
  }
}

function createMockProcess(): { proc: ChildProcess; stdin: MockWritable; stdout: MockReadable } {
  const stdin = new MockWritable();
  const stdout = new MockReadable();
  const stderr = new MockReadable();
  const proc = new EventEmitter() as ChildProcess;
  proc.stdin = stdin as any;
  proc.stdout = stdout as any;
  proc.stderr = stderr as any;
  Object.defineProperty(proc, "exitCode", { value: 0, writable: true, configurable: true });
  return { proc, stdin, stdout };
}

async function testBootstrapInjectsPromptAsUserPrefix(): Promise<void> {
  const { proc, stdin, stdout } = createMockProcess();
  let capturedArgs: string[] = [];
  const mockSpawn = ((_cmd: string, args: string[]) => {
    capturedArgs = args;
    return proc;
  }) as any;

  const agent = new ClaudeCodeStatefulAgent(mockSpawn);
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: {
      systemPrompt: "snail-shell-role",
      messages: [{ role: "user", content: "hello" }],
    },
    incrementalMessages: [{ role: "user", content: "do task" }],
    systemReminder: "",
  };

  const invocation = agent.invokeStateful(input, () => {});
  stdout.pushLine(JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "ok" }] } }));
  stdout.pushLine(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok" }));
  stdout.finish();
  closeProcessSoon(proc);
  await invocation;

  assert(capturedArgs.includes("--append-system-prompt-file"), "bootstrap must use --append-system-prompt-file for system prompt");
  assert(stdin.written.length >= 1, "claude invocation should write stdin payload");
  const payload = JSON.parse(stdin.written[0]!);
  const userContent = payload.message?.content?.[0]?.text;
  assert(userContent === "hello\n\ndo task", "stateful bootstrap should send mapped content without system prompt in user message");
  assert(!userContent.includes("USER:\nhello"), "stateful bootstrap must not synthesize USER labels");
  console.log("✓ testBootstrapInjectsPromptAsUserPrefix passed");
}

async function testResumeOmitsSystemPrompt(): Promise<void> {
  const { proc, stdin, stdout } = createMockProcess();
  let capturedArgs: string[] = [];
  const mockSpawn = ((_cmd: string, args: string[]) => {
    capturedArgs = args;
    return proc;
  }) as any;

  const agent = new ClaudeCodeStatefulAgent(mockSpawn);
  const input: StatefulInvocationInput = {
    sessionId: "session-abc",
    bootstrap: null,
    incrementalMessages: [{ role: "user", content: "continue" }],
    systemReminder: "",
  };

  const invocation = agent.invokeStateful(input, () => {});
  stdout.pushLine(JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "ok" }] } }));
  stdout.pushLine(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok" }));
  stdout.finish();
  closeProcessSoon(proc);
  await invocation;

  assert(!capturedArgs.includes("--append-system-prompt-file"), "resume must not include --append-system-prompt-file");
  assert(capturedArgs.includes("--resume"), "resume should include --resume flag");
  const payload = JSON.parse(stdin.written[0]!);
  const userContent = payload.message?.content?.[0]?.text;
  assert(userContent === "continue", "stateful resume should send only mapped incremental content");
  assert(!userContent.includes("USER:\ncontinue"), "stateful resume must not synthesize USER labels");
  console.log("✓ testResumeOmitsSystemPrompt passed");
}

/**
 * stdout stream error 在已有部分事件但无 result 时必须 reject，不得静默成功。
 * 场景：收到 assistant 事件后 stream error，无 result → 应抛出异常。
 */
async function testStatefulStdoutStreamErrorRejectsWithPartialOutput(): Promise<void> {
  const { proc, stdout } = createMockProcess();

  const agent = new ClaudeCodeStatefulAgent((() => proc) as any);
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: {
      systemPrompt: "snail-shell-role",
      messages: [{ role: "user", content: "hello" }],
    },
    incrementalMessages: [{ role: "user", content: "do task" }],
    systemReminder: "",
  };

  const invocation = agent.invokeStateful(input, () => {});
  // 收到部分输出（assistant 事件）
  stdout.pushLine(JSON.stringify({
    type: "assistant",
    message: { id: "msg_1", content: [{ type: "text", text: "partial output" }] },
  }));
  // stdout stream 出错，无 result 事件
  stdout.emit("error", new Error("EPIPE: broken pipe"));
  closeProcessSoon(proc);

  let failed = false;
  try {
    await invocation;
  } catch (error) {
    failed = error instanceof Error && error.message.includes("stdout stream error");
  }
  assert(failed, "stateful stdout stream error after partial output should reject, not silently succeed");
  console.log("✓ testStatefulStdoutStreamErrorRejectsWithPartialOutput passed");
}

/**
 * stdout stream error 在已有 result 后不影响成功收口。
 * promise 已 resolve → 后续 reject 被忽略。
 */
async function testStatefulStdoutStreamErrorAfterResultIsIgnored(): Promise<void> {
  const { proc, stdout } = createMockProcess();

  const agent = new ClaudeCodeStatefulAgent((() => proc) as any);
  const input: StatefulInvocationInput = {
    sessionId: "session-abc",
    bootstrap: null,
    incrementalMessages: [{ role: "user", content: "continue" }],
    systemReminder: "",
  };

  const invocation = agent.invokeStateful(input, () => {});
  stdout.pushLine(JSON.stringify({
    type: "assistant",
    message: { id: "msg_1", content: [{ type: "text", text: "done" }] },
  }));
  stdout.pushLine(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done" }));
  // result 之后 stream error → promise 已 resolve，reject 被忽略
  stdout.emit("error", new Error("ECONNRESET"));
  closeProcessSoon(proc);
  await invocation;

  console.log("✓ testStatefulStdoutStreamErrorAfterResultIsIgnored passed");
}

async function testHardPermissionDenialsBecomeFailureEvents(): Promise<void> {
  const { proc, stdout } = createMockProcess();
  const mockSpawn = (() => proc) as any;

  const agent = new ClaudeCodeStatefulAgent(mockSpawn);
  /** sqlite3 匹配 deny pattern → 硬拒绝 */
  (agent as any).currentGuardProfile = {
    allow: ["Bash(node:*)"],
    deny: ["Bash(sqlite3:*)"],
  };
  const events: any[] = [];
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: { systemPrompt: "system", messages: [{ role: "user", content: "do work" }] },
    incrementalMessages: [],
    systemReminder: "",
  };

  const invocation = agent.invokeStateful(input, (event) => events.push(event));
  stdout.pushLine(JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "start" }] } }));
  stdout.pushLine(JSON.stringify({
    type: "result", subtype: "success", is_error: false, result: "",
    permission_denials: [{ tool_name: "Bash", tool_use_id: "call_1", tool_input: { command: "sqlite3 test.db \"INSERT INTO t VALUES(1)\"" } }],
  }));
  stdout.finish();
  closeProcessSoon(proc);
  await invocation;

  const errorEvent = events.find((event) => event.type === "message_event" && event.event.kind === "error");
  const failureEvent = events.find((event) => event.type === "message_failure");
  assert(errorEvent != null, "hard denial should produce error event");
  assert(failureEvent != null, "hard denial should produce message_failure");
  console.log("✓ testHardPermissionDenialsBecomeFailureEvents passed");
}

async function testSoftPermissionDenialsBecomePermissionRequired(): Promise<void> {
  const { proc, stdout } = createMockProcess();
  const mockSpawn = (() => proc) as any;

  const agent = new ClaudeCodeStatefulAgent(mockSpawn);
  /** 无 guard profile → 所有 denial 都是软拒绝 */
  (agent as any).currentGuardProfile = null;
  const events: any[] = [];
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: { systemPrompt: "system", messages: [{ role: "user", content: "do work" }] },
    incrementalMessages: [],
    systemReminder: "",
  };

  const invocation = agent.invokeStateful(input, (event) => events.push(event));
  stdout.pushLine(JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "start" }] } }));
  stdout.pushLine(JSON.stringify({
    type: "result", subtype: "success", is_error: false, result: "",
    permission_denials: [{ tool_name: "ExitPlanMode", tool_use_id: "call_1", tool_input: { plan: "plan" } }],
  }));
  stdout.finish();
  closeProcessSoon(proc);
  await invocation;

  const permEvent = events.find((event) => event.type === "permission_required");
  const signalEvent = events.find((event) => event.type === "message_event" && event.event.kind === "signal" && event.event.payload?.type === "permission_blocked");
  const failureEvent = events.find((event) => event.type === "message_failure");
  assert(permEvent != null, "soft denial should produce permission_required event");
  assert(permEvent.request.tool_name === "ExitPlanMode", "permission_required should carry tool name");
  assert(signalEvent != null, "soft denial should produce permission_blocked signal");
  assert(failureEvent == null, "soft denial should NOT produce message_failure");
  console.log("✓ testSoftPermissionDenialsBecomePermissionRequired passed");
}

/**
 * 同一 result 包含 hard denial + soft denial 时，hard denial 优先：只 emit message_failure，不 emit permission_required。
 * 场景：sqlite3（deny 匹配 → 硬拒绝）+ WebSearch（不在名单中 → 软拒绝）同时出现在 permission_denials 中。
 */
async function testMixedDenialsHardTakesPriority(): Promise<void> {
  const { proc, stdout } = createMockProcess();
  const mockSpawn = (() => proc) as any;

  const agent = new ClaudeCodeStatefulAgent(mockSpawn);
  /** sqlite3 匹配 deny pattern → 硬拒绝；WebSearch 不在名单中 → 软拒绝 */
  (agent as any).currentGuardProfile = {
    allow: ["Bash(node:*)"],
    deny: ["Bash(sqlite3:*)"],
  };
  const events: any[] = [];
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: { systemPrompt: "system", messages: [{ role: "user", content: "do work" }] },
    incrementalMessages: [],
    systemReminder: "",
  };

  const invocation = agent.invokeStateful(input, (event) => events.push(event));
  stdout.pushLine(JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "start" }] } }));
  stdout.pushLine(JSON.stringify({
    type: "result", subtype: "success", is_error: false, result: "",
    permission_denials: [
      { tool_name: "Bash", tool_use_id: "call_1", tool_input: { command: "sqlite3 test.db \"INSERT INTO t VALUES(1)\"" } },
      { tool_name: "WebSearch", tool_use_id: "call_2", tool_input: { query: "test" } },
    ],
  }));
  stdout.finish();
  closeProcessSoon(proc);
  await invocation;

  const failureEvent = events.find((event) => event.type === "message_failure");
  const permEvent = events.find((event) => event.type === "permission_required");
  assert(failureEvent != null, "mixed denials should produce message_failure (hard denial present)");
  assert(permEvent == null, "mixed denials should NOT produce permission_required (hard denial takes priority)");
  console.log("✓ testMixedDenialsHardTakesPriority passed");
}

async function main(): Promise<void> {
  await testBootstrapInjectsPromptAsUserPrefix();
  await testResumeOmitsSystemPrompt();
  await testStatefulStdoutStreamErrorRejectsWithPartialOutput();
  await testStatefulStdoutStreamErrorAfterResultIsIgnored();
  await testHardPermissionDenialsBecomeFailureEvents();
  await testSoftPermissionDenialsBecomePermissionRequired();
  await testMixedDenialsHardTakesPriority();
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
