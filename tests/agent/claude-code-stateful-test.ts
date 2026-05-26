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

async function main(): Promise<void> {
  await testBootstrapInjectsPromptAsUserPrefix();
  await testResumeOmitsSystemPrompt();
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
