import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { AgentEvent } from "@infra/acs/model";

vi.mock("child_process", () => ({ spawn: vi.fn() }));
vi.mock("@infra/acs/_internal/utils/skill-symlinks", () => ({ ensureSkillSymlinks: vi.fn() }));

import { spawn } from "child_process";
import { PiMonoAgent } from "@infra/acs/_internal/agents/pi-mono";

const mockSpawn = vi.mocked(spawn);

interface FakeChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; destroyed: boolean };
  pid: number;
  exitCode: number | null;
  killed: boolean;
}

function createFakeChildProcess(): FakeChildProcess {
  const proc = new EventEmitter() as FakeChildProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn(), destroyed: false };
  proc.pid = 12345;
  proc.exitCode = null;
  proc.killed = false;
  (proc as any).kill = vi.fn().mockReturnValue(true);
  return proc;
}

function emitNdjson(proc: FakeChildProcess, lines: string[]): void {
  proc.stdout.emit("data", lines.join("\n") + "\n");
}

function closeProc(proc: FakeChildProcess, code: number | null = 0): void {
  proc.emit("close", code);
}

function createFirstCallRequest(overrides: Record<string, unknown> = {}) {
  return {
    prompt: { systemPrompt: "You are a helpful assistant.", systemReminder: "Context info" },
    capabilities: { skills: [], mcpServers: [] },
    guard_profile: { deny: [] as string[], allow: [] as string[] },
    messages: [{ role: "human" as const, speaker: "user", content: "hello" }],
    workspacePath: "/tmp/test-workspace",
    snailKey: "test-snail",
    messageId: "msg-1",
    ...overrides,
  };
}

function createResumeRequest(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "existing-session-id",
    systemReminder: "Updated context",
    messages: [{ role: "human" as const, speaker: "user", content: "follow up" }],
    workspacePath: "/tmp/test-workspace",
    snailKey: "test-snail",
    messageId: "msg-2",
    ...overrides,
  };
}

function createInvokeOptions(overrides: Record<string, unknown> = {}) {
  return { model: "anthropic/claude-sonnet-4-20250514", contextWindow: 200000, ...overrides };
}

function setupSpawnAndCollect(): { proc: FakeChildProcess; events: AgentEvent[] } {
  const proc = createFakeChildProcess();
  const events: AgentEvent[] = [];
  mockSpawn.mockReturnValue(proc as any);
  return { proc, events };
}

async function runInvocation(
  agent: PiMonoAgent, method: "invokeFirstCall" | "invokeResume",
  request: any, options: any, proc: FakeChildProcess, events: AgentEvent[],
  ndjsonLines: string[], exitCode: number | null = 0,
): Promise<any> {
  const promise = agent[method](request, (e) => events.push(e), options);
  await new Promise(resolve => setImmediate(resolve));
  if (ndjsonLines.length > 0) emitNdjson(proc, ndjsonLines);
  closeProc(proc, exitCode);
  return promise;
}

const TEXT_EVENT = JSON.stringify({ type: "message_end", message: { content: [{ type: "text", text: "ok" }] } });
const SESSION_EVENT = (id: string) => JSON.stringify({ type: "session", id });
const AGENT_END_EVENT = JSON.stringify({ type: "agent_end" });

beforeEach(() => vi.clearAllMocks());

// ── Basic ────────────────────────────────────────────────────────────

describe("PiMonoAgent basic", () => {
  it("has name 'pi-mono'", () => {
    expect(new PiMonoAgent().name).toBe("pi-mono");
  });
});

// ── CLI args ─────────────────────────────────────────────────────────

describe("PiMonoAgent invokeFirstCall CLI args", () => {
  it("builds correct args with --mode json, --model, --approve, --append-system-prompt", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("sess-123"), TEXT_EVENT, AGENT_END_EVENT]);

    expect(mockSpawn).toHaveBeenCalled();
    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe("pi");
    expect(args).toContain("--mode");
    expect(args).toContain("json");
    expect(args).toContain("--model");
    expect(args).toContain("anthropic/claude-sonnet-4-20250514");
    expect(args).toContain("--approve");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("You are a helpful assistant.");
  });

  it("includes --exclude-tools when deny is non-empty", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall",
      createFirstCallRequest({ guard_profile: { deny: ["Bash(rm:*)", "Read", "Write"], allow: [] } }),
      createInvokeOptions(), proc, events, [SESSION_EVENT("sess-123"), TEXT_EVENT, AGENT_END_EVENT]);

    const [, args] = mockSpawn.mock.calls[0];
    const idx = args.indexOf("--exclude-tools");
    expect(idx).toBeGreaterThan(-1);
    const toolsArg = args[idx + 1];
    expect(toolsArg).toContain("bash");
    expect(toolsArg).toContain("read");
    expect(toolsArg).toContain("write");
  });

  it("omits --exclude-tools when deny is empty", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("sess-123"), TEXT_EVENT, AGENT_END_EVENT]);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).not.toContain("--exclude-tools");
  });

  it("omits --append-system-prompt when systemPrompt is empty", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall",
      createFirstCallRequest({ prompt: { systemPrompt: "", systemReminder: "reminder" } }),
      createInvokeOptions(), proc, events, [SESSION_EVENT("sess-123"), TEXT_EVENT, AGENT_END_EVENT]);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).not.toContain("--append-system-prompt");
  });

  it("does not include systemPrompt in prompt text (sent via --append-system-prompt only)", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("sess-123"), TEXT_EVENT, AGENT_END_EVENT]);

    const [, args] = mockSpawn.mock.calls[0];
    const promptTextArg = args[args.length - 1];
    expect(promptTextArg).not.toContain("You are a helpful assistant.");
    expect(promptTextArg).not.toContain("当前任务上下文");
  });
});

describe("PiMonoAgent invokeResume CLI args", () => {
  it("builds correct args with --session", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeResume", createResumeRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("existing-session-id"), TEXT_EVENT, AGENT_END_EVENT]);

    expect(mockSpawn).toHaveBeenCalled();
    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe("pi");
    expect(args).toContain("--mode");
    expect(args).toContain("json");
    expect(args).toContain("--session");
    expect(args).toContain("existing-session-id");
    expect(args).toContain("--approve");
    expect(args).not.toContain("--append-system-prompt");
    expect(args).not.toContain("--exclude-tools");
  });
});

// ── NDJSON parsing: session, text, tool events ──────────────────────

describe("PiMonoAgent NDJSON parsing (session/text/tool)", () => {
  it("B2: extracts session ID from session event", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    const result = await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("sess-abc-123"), TEXT_EVENT, AGENT_END_EVENT]);
    expect(result.sessionId).toBe("sess-abc-123");
  });

  it("B3: emits text event from message_end with text content", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "message_end", message: { content: [{ type: "text", text: "Hello world" }] } }), AGENT_END_EVENT]);

    const textEvents = events.filter(e => e.event.kind === "text");
    expect(textEvents).toHaveLength(1);
    expect((textEvents[0].event as any).payload.text).toBe("Hello world");
  });

  it("B4: emits tool_call from tool_execution_start", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "tool_execution_start", tool: "bash", input: { command: "ls" }, id: "call-1" }), AGENT_END_EVENT]);

    const tc = events.filter(e => e.event.kind === "tool_call");
    expect(tc).toHaveLength(1);
    expect((tc[0].event as any).payload.tool_name).toBe("bash");
    expect((tc[0].event as any).payload.call_id).toBe("call-1");
  });

  it("B5: emits tool_result from tool_execution_end", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "tool_execution_end", tool: "bash", output: "file.txt", error: null, id: "call-1" }), AGENT_END_EVENT]);

    const tr = events.filter(e => e.event.kind === "tool_result");
    expect(tr).toHaveLength(1);
    expect((tr[0].event as any).payload.output).toBe("file.txt");
    expect((tr[0].event as any).payload.is_error).toBe(false);
  });

  it("B5: tool_result is_error=true when error field present", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "tool_execution_end", tool: "bash", output: "", error: "command failed", id: "call-1" }), AGENT_END_EVENT]);

    const tr = events.filter(e => e.event.kind === "tool_result");
    expect((tr[0].event as any).payload.is_error).toBe(true);
  });

  it("B15: message_end without text content is a no-op", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"),
       JSON.stringify({ type: "message_end", message: { content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }] } }),
       JSON.stringify({ type: "tool_execution_start", tool: "bash", input: { command: "ls" }, id: "t1" }),
       AGENT_END_EVENT]);

    expect(events.filter(e => e.event.kind === "text")).toHaveLength(0);
  });
});

// ── NDJSON parsing: signals and lifecycle ────────────────────────────

describe("PiMonoAgent NDJSON parsing (signals)", () => {
  it("B6: emits signal(turn_started) from turn_start", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "turn_start" }), TEXT_EVENT, AGENT_END_EVENT]);

    expect(events.filter(e => e.event.kind === "signal" && (e.event as any).payload.signal_type === "turn_started")).toHaveLength(1);
  });

  it("B7: emits signal(turn_completed) from turn_end", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "turn_end" }), TEXT_EVENT, AGENT_END_EVENT]);

    expect(events.filter(e => e.event.kind === "signal" && (e.event as any).payload.signal_type === "turn_completed")).toHaveLength(1);
  });

  it("B8: emits signal(message_completed) from agent_end", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), TEXT_EVENT, AGENT_END_EVENT]);

    expect(events.filter(e => e.event.kind === "signal" && (e.event as any).payload.signal_type === "message_completed")).toHaveLength(1);
  });

  it("B14: emits signal(start) from agent_start", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "agent_start" }), TEXT_EVENT, AGENT_END_EVENT]);

    expect(events.filter(e => e.event.kind === "signal" && (e.event as any).payload.signal_type === "start")).toHaveLength(1);
  });
});

// ── NDJSON parsing: usage, ignore, error ─────────────────────────────

describe("PiMonoAgent NDJSON parsing (usage/ignore/error)", () => {
  it("B16: emits runtime_usage when turn_end carries usage data", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"),
       JSON.stringify({ type: "turn_end", usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }),
       TEXT_EVENT, AGENT_END_EVENT]);

    const usageSignals = events.filter(e => e.event.kind === "signal" && (e.event as any).payload.signal_type === "runtime_usage");
    expect(usageSignals).toHaveLength(1);
    const detail = (usageSignals[0].event as any).payload.data.detail;
    expect(detail.input_tokens).toBe(100);
    expect(detail.output_tokens).toBe(50);
    expect(detail.total_tokens).toBe(150);
  });

  it("B16: emits runtime_usage from agent_end with tokens field", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), TEXT_EVENT,
       JSON.stringify({ type: "agent_end", tokens: { input_tokens: 200, output_tokens: 100 } })]);

    expect(events.filter(e => e.event.kind === "signal" && (e.event as any).payload.signal_type === "runtime_usage")).toHaveLength(1);
  });

  it("B16: does not emit runtime_usage when no usage data present", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "turn_end" }), TEXT_EVENT, AGENT_END_EVENT]);

    expect(events.filter(e => e.event.kind === "signal" && (e.event as any).payload.signal_type === "runtime_usage")).toHaveLength(0);
  });

  it("B17: ignores message_update events", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"),
       JSON.stringify({ type: "message_update", text_delta: "partial" }),
       JSON.stringify({ type: "message_end", message: { content: [{ type: "text", text: "final text" }] } }),
       AGENT_END_EVENT]);

    const textEvents = events.filter(e => e.event.kind === "text");
    expect(textEvents).toHaveLength(1);
    expect((textEvents[0].event as any).payload.text).toBe("final text");
  });

  it("B18: ignores message_start events", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "message_start" }),
       JSON.stringify({ type: "message_end", message: { content: [{ type: "text", text: "hello" }] } }),
       AGENT_END_EVENT]);

    expect(events.filter(e => e.event.kind === "text")).toHaveLength(1);
  });

  it("B17: message_update with error field emits error event", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await expect(runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "message_update", error: "stream error" })],
    )).rejects.toThrow("stream error");

    expect(events.filter(e => e.event.kind === "error")).toHaveLength(1);
  });

  it("B9: emits error event from error type", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await expect(runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), JSON.stringify({ type: "error", error: "Something went wrong" })],
    )).rejects.toThrow("Something went wrong");

    const errorEvents = events.filter(e => e.event.kind === "error");
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0].event as any).payload.message).toBe("Something went wrong");
  });
});

// ── Error handling ───────────────────────────────────────────────────

describe("PiMonoAgent error handling", () => {
  it("B12: throws on non-zero exit code", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await expect(runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events, [], 1,
    )).rejects.toThrow(/pi-mono failed/);
  });

  it("throws when no output events and exit code 0", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await expect(runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1")], 0,
    )).rejects.toThrow(/no output events/);
  });

  it("throws on runtime errors even with exit code 0", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await expect(runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"),
       JSON.stringify({ type: "error", error: "runtime failure" }),
       JSON.stringify({ type: "message_end", message: { content: [{ type: "text", text: "text" }] } })], 0,
    )).rejects.toThrow("runtime failure");
  });

  it("includes stderr in error message on non-zero exit", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    const promise = agent.invokeFirstCall(createFirstCallRequest(), (e) => events.push(e), createInvokeOptions());
    await new Promise(resolve => setImmediate(resolve));
    proc.stderr.emit("data", Buffer.from("STDERR_ERROR_MSG"));
    closeProc(proc, 1);
    await expect(promise).rejects.toThrow("STDERR_ERROR_MSG");
  });
});

// ── Guard profile translation ────────────────────────────────────────

describe("PiMonoAgent guard profile translation", () => {
  it("translates Bash(...) to bash", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall",
      createFirstCallRequest({ guard_profile: { deny: ["Bash(rm:*)", "Bash(git push:*)"], allow: [] } }),
      createInvokeOptions(), proc, events, [SESSION_EVENT("s1"), TEXT_EVENT, AGENT_END_EVENT]);

    const [, args] = mockSpawn.mock.calls[0];
    const idx = args.indexOf("--exclude-tools");
    expect(args[idx + 1]).toBe("bash");
  });

  it("translates Read/Write/Edit to lowercase", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall",
      createFirstCallRequest({ guard_profile: { deny: ["Read", "Write", "Edit"], allow: [] } }),
      createInvokeOptions(), proc, events, [SESSION_EVENT("s1"), TEXT_EVENT, AGENT_END_EVENT]);

    const [, args] = mockSpawn.mock.calls[0];
    const tools = args[args.indexOf("--exclude-tools") + 1].split(",");
    expect(tools).toContain("read");
    expect(tools).toContain("write");
    expect(tools).toContain("edit");
  });

  it("skips AskUserQuestion, EnterPlanMode, ExitPlanMode", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall",
      createFirstCallRequest({ guard_profile: { deny: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "Read"], allow: [] } }),
      createInvokeOptions(), proc, events, [SESSION_EVENT("s1"), TEXT_EVENT, AGENT_END_EVENT]);

    const [, args] = mockSpawn.mock.calls[0];
    const tools = args[args.indexOf("--exclude-tools") + 1].split(",");
    expect(tools).toContain("read");
    expect(tools).not.toContain("askuserquestion");
    expect(tools).not.toContain("enterplanmode");
    expect(tools).not.toContain("exitplanmode");
  });
});

// ── Environment and prompt ───────────────────────────────────────────

describe("PiMonoAgent environment variables", () => {
  it("cleans PI_* env vars and injects contextEnv", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    process.env.PI_CODING_AGENT_DIR = "/global/pi/dir";
    process.env.PI_OFFLINE = "true";

    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(),
      createInvokeOptions({ contextEnv: { SNAIL_CTX_ISSUE_ID: "issue-123" } }),
      proc, events, [SESSION_EVENT("s1"), TEXT_EVENT, AGENT_END_EVENT]);

    const [, , opts] = mockSpawn.mock.calls[0] as any[];
    expect(opts.env.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(opts.env.PI_OFFLINE).toBeUndefined();
    expect(opts.env.SNAIL_CTX_ISSUE_ID).toBe("issue-123");

    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env.PI_OFFLINE;
  });
});

describe("PiMonoAgent prompt stdin fallback", () => {
  it("uses stdin when prompt exceeds 64KB threshold", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    const largeContent = "A".repeat(70 * 1024);
    await runInvocation(agent, "invokeFirstCall",
      createFirstCallRequest({ messages: [{ role: "human" as const, speaker: "user", content: largeContent }] }),
      createInvokeOptions(), proc, events, [SESSION_EVENT("s1"), TEXT_EVENT, AGENT_END_EVENT]);

    expect(proc.stdin.write).toHaveBeenCalled();
    expect(proc.stdin.end).toHaveBeenCalled();
    const [, , opts] = mockSpawn.mock.calls[0] as any[];
    expect(opts.stdio[0]).toBe("pipe");
  });

  it("uses CLI arg when prompt is under 64KB threshold", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall", createFirstCallRequest(), createInvokeOptions(), proc, events,
      [SESSION_EVENT("s1"), TEXT_EVENT, AGENT_END_EVENT]);

    expect(proc.stdin.write).not.toHaveBeenCalled();
    const [, , opts] = mockSpawn.mock.calls[0] as any[];
    expect(opts.stdio[0]).toBe("ignore");
  });
});

describe("PiMonoAgent MCP not called", () => {
  it("does not call ensureMcpServers (MCP not supported)", async () => {
    const agent = new PiMonoAgent();
    const { proc, events } = setupSpawnAndCollect();
    await runInvocation(agent, "invokeFirstCall",
      createFirstCallRequest({ capabilities: { skills: [], mcpServers: [{ name: "test-mcp", command: "test" }] } }),
      createInvokeOptions(), proc, events, [SESSION_EVENT("s1"), TEXT_EVENT, AGENT_END_EVENT]);

    const { ensureSkillSymlinks } = await import("@infra/acs/_internal/utils/skill-symlinks");
    expect(ensureSkillSymlinks).toHaveBeenCalled();
  });
});
