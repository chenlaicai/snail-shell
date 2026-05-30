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

/**
 * permission_denials 是 Claude Code 执行结果的既成事实——工具已被拒绝，Claude Code 已继续执行。
 * deny 列表中的工具在 settings.local.json 层面已被 Claude Code 事前拒绝，
 * Snail Shell 不再做二次判定，所有 denials 均忽略。
 */
async function testDenyListDenialsAreIgnored(): Promise<void> {
  const { proc, stdout } = createMockProcess();
  const mockSpawn = (() => proc) as any;

  const agent = new ClaudeCodeStatefulAgent(mockSpawn);
  const events: any[] = [];
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: { systemPrompt: "system", messages: [{ role: "user", content: "do work" }] },
    incrementalMessages: [],
    systemReminder: "",
  };

  const invocation = agent.invokeStateful(input, (event) => events.push(event));
  stdout.pushLine(JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "start" }] } }));
  // sqlite3 denial → 既成事实，忽略
  stdout.pushLine(JSON.stringify({
    type: "result", subtype: "success", is_error: false, result: "",
    permission_denials: [{ tool_name: "Bash", tool_use_id: "call_1", tool_input: { command: "sqlite3 test.db \"INSERT INTO t VALUES(1)\"" } }],
  }));
  stdout.finish();
  closeProcessSoon(proc);
  await invocation;

  const failureEvent = events.find((event) => event.type === "message_failure");
  assert(failureEvent == null, "permission_denials should be ignored (settled by Claude Code)");
  console.log("✓ testDenyListDenialsAreIgnored passed");
}

async function testNonDenyListDenialsAreIgnored(): Promise<void> {
  const { proc, stdout } = createMockProcess();
  const mockSpawn = (() => proc) as any;

  const agent = new ClaudeCodeStatefulAgent(mockSpawn);
  const events: any[] = [];
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: { systemPrompt: "system", messages: [{ role: "user", content: "do work" }] },
    incrementalMessages: [],
    systemReminder: "",
  };

  const invocation = agent.invokeStateful(input, (event) => events.push(event));
  stdout.pushLine(JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "start" }] } }));
  // ExitPlanMode denial → 既成事实，忽略
  stdout.pushLine(JSON.stringify({
    type: "result", subtype: "success", is_error: false, result: "",
    permission_denials: [{ tool_name: "ExitPlanMode", tool_use_id: "call_1", tool_input: { plan: "plan" } }],
  }));
  stdout.finish();
  closeProcessSoon(proc);
  await invocation;

  const failureEvent = events.find((event) => event.type === "message_failure");
  /** 所有 permission_denials 均忽略（既成事实） */
  assert(failureEvent == null, "permission_denials should be ignored (settled by Claude Code)");
  console.log("✓ testNonDenyListDenialsAreIgnored passed");
}

/**
 * 同一 result 包含多个 permission_denials 时，全部忽略（既成事实）。
 * 场景：sqlite3 + WebSearch 同时出现在 permission_denials 中。
 */
async function testMixedDenialsAreAllIgnored(): Promise<void> {
  const { proc, stdout } = createMockProcess();
  const mockSpawn = (() => proc) as any;

  const agent = new ClaudeCodeStatefulAgent(mockSpawn);
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
  assert(failureEvent == null, "all permission_denials should be ignored (settled by Claude Code)");
  console.log("✓ testMixedDenialsAreAllIgnored passed");
}

async function main(): Promise<void> {
  await testBootstrapInjectsPromptAsUserPrefix();
  await testResumeOmitsSystemPrompt();
  await testStatefulStdoutStreamErrorRejectsWithPartialOutput();
  await testStatefulStdoutStreamErrorAfterResultIsIgnored();
  await testDenyListDenialsAreIgnored();
  await testNonDenyListDenialsAreIgnored();
  await testMixedDenialsAreAllIgnored();
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
