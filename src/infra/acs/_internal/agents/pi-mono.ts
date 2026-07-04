import { spawn } from "child_process";
import type { AgentRuntimePort } from "@infra/acs/port";
import type { FirstCallRequest, ResumeRequest, AgentEvent, InvokeResult, InvokeOptions, Message, LifecycleSignal } from "@infra/acs/model";
import { manageInvocationProcess } from "@infra/acs/_internal/utils/managed-process";
import { renderStatefulPrompt, type StatefulPromptInput } from "@infra/acs/_internal/utils/stateful-prompt-format";
import { buildRuntimeUsageSignal, usageDetailFromPiMono } from "@infra/acs/_internal/utils/runtime-usage";
import { ensureSkillSymlinks } from "@infra/acs/_internal/utils/skill-symlinks";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "pi-mono" });

/** Pi Mono 自身的环境变量，避免全局配置污染 worktree 级别调用 */
const PI_ENV_KEYS = [
  "PI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_SESSION_DIR",
  "PI_OFFLINE",
] as const;

/** CLI 参数安全阈值，超过此长度改用 stdin 管道传递 prompt */
const PROMPT_STDIN_THRESHOLD = 64 * 1024;

interface PiMonoEvent {
  type: string;
  id?: string;
  message?: { content?: Array<{ type: string; text?: string }> };
  tool?: string;
  input?: unknown;
  output?: string;
  error?: string | null;
  usage?: unknown;
  tokens?: unknown;
  [key: string]: unknown;
}

interface PiMonoParseState {
  buffer: string;
  outputEventCount: number;
  sessionId: string | null;
  contextWindow: number | null;
  errors: string[];
  rawOutput: string[];
}

/**
 * Pi Mono 适配器。
 *
 * 有状态 agent：首次调用注入完整配置，后续调用通过 --session resume。
 * 不支持 MCP；guard profile 通过 --exclude-tools 实现。
 */
export class PiMonoAgent implements AgentRuntimePort {
  readonly name = "pi-mono";
  private static readonly DEFAULT_MODEL = "anthropic/claude-sonnet-4-20250514";

  /**
   * 首次调用：注入 skills 符号链接 + 系统提示词 + guard profile。
   */
  async invokeFirstCall(
    request: FirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    log.info({
      workspacePath: request.workspacePath,
      messageCount: request.messages.length,
      model: options.model ?? PiMonoAgent.DEFAULT_MODEL,
    }, "invokeFirstCall");

    // 注入 skills（pi 原生扫描 .agents/skills/，ensureSkillSymlinks 已覆盖）
    ensureSkillSymlinks(request.workspacePath, request.capabilities.skills);
    // MCP 不支持，跳过 ensureMcpServers

    const model = options.model ?? PiMonoAgent.DEFAULT_MODEL;
    const statefulInput = buildStatefulPromptInput(true, request.prompt.systemPrompt, request.prompt.systemReminder, request.messages);
    const promptText = renderStatefulPrompt(statefulInput, { skipSystemPrompt: true });
    const excludeTools = translatePiMonoTools(request.guard_profile.deny);
    const args = buildFirstCallArgs(model, request.prompt.systemPrompt, excludeTools, promptText);

    const proc = this.spawn(args, request.workspacePath, options, promptText);

    return this.processOutput(proc, onEvent, options, null);
  }

  /**
   * 后续调用：通过 --session resume，仅传增量消息。
   */
  async invokeResume(
    request: ResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const model = options.model ?? PiMonoAgent.DEFAULT_MODEL;
    const statefulInput = buildStatefulPromptInput(false, "", request.systemReminder, request.messages);
    const promptText = renderStatefulPrompt(statefulInput, { skipSystemPrompt: false });
    const args = buildResumeArgs(model, request.sessionId, promptText);

    const proc = this.spawn(args, request.workspacePath, options, promptText);

    return this.processOutput(proc, onEvent, options, request.sessionId);
  }

  // ── 通用辅助方法 ──────────────────────────────────────────────────────

  /** Spawn pi 进程，prompt 超过阈值时通过 stdin 传递 */
  private spawn(args: string[], workspacePath: string, options: InvokeOptions, promptText: string) {
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const key of PI_ENV_KEYS) {
      delete env[key];
    }
    if (options.contextEnv) {
      Object.assign(env, options.contextEnv);
    }

    let finalArgs = args;
    let useStdin = false;

    // prompt 超过安全阈值时改用 stdin 管道传递
    if (promptText.length > PROMPT_STDIN_THRESHOLD) {
      finalArgs = args.filter(a => a !== promptText);
      useStdin = true;
    }

    const proc = spawn("pi", finalArgs, {
      cwd: workspacePath,
      env,
      stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
      detached: true,
    });

    if (useStdin && proc.stdin) {
      proc.stdin.write(promptText);
      proc.stdin.end();
    }

    return proc;
  }

  /** 处理进程输出，返回 InvokeResult */
  private async processOutput(
    proc: ReturnType<typeof spawn>,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions,
    existingSessionId: string | null,
  ): Promise<InvokeResult> {
    const processController = manageInvocationProcess({
      proc,
      agentName: "PiMono",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    let stderr = "";
    let stopRequested = false;
    const state: PiMonoParseState = {
      buffer: "",
      outputEventCount: 0,
      sessionId: existingSessionId,
      contextWindow: options.contextWindow ?? null,
      errors: [],
      rawOutput: [],
    };

    const stopAfterRuntimeError = () => {
      if (stopRequested || state.errors.length === 0 || !proc.pid) return;
      stopRequested = true;
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {
        if (!proc.killed) proc.kill("SIGTERM");
      }
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      consumePiMonoOutput(state, chunk.toString(), onEvent);
      stopAfterRuntimeError();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      proc.on("error", (error) => {
        processController.cleanup();
        reject(error);
      });
      proc.on("close", (code) => {
        processController.cleanup();
        resolve(code);
      });
    });

    flushPiMonoOutput(state, onEvent);
    await processController.throwIfStopped();

    this.throwIfFailed(exitCode, stderr, state);

    log.info({
      sessionId: state.sessionId,
      outputEventCount: state.outputEventCount,
    }, "invocation completed");

    return { sessionId: state.sessionId, waitForStop: () => processController.waitForStop() };
  }

  private throwIfFailed(exitCode: number | null, stderr: string, state: PiMonoParseState): void {
    if (exitCode !== 0) {
      const errorMsg = stderr || "Unknown error";
      log.error({
        exitCode, stderr: stderr.slice(0, 500), outputEventCount: state.outputEventCount,
        runtimeErrors: state.errors, rawOutput: state.rawOutput.join("").slice(0, 1000),
      }, "process exited with non-zero code");
      throw new Error(`pi-mono failed (exit ${exitCode}): ${errorMsg}`);
    }

    if (state.errors.length > 0) {
      log.error({ errors: state.errors, rawOutput: state.rawOutput.join("").slice(0, 1000) }, "runtime errors");
      throw new Error(`pi-mono failed: ${state.errors.join("; ")}`);
    }

    if (state.outputEventCount === 0) {
      log.error({ stderr: stderr.slice(0, 500), rawOutputLength: state.rawOutput.length }, "no output events");
      throw new Error(`pi-mono returned no output events${formatPiMonoDiagnostics(stderr, state)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 内部辅助函数
// ═══════════════════════════════════════════════════════════

function buildFirstCallArgs(model: string, systemPrompt: string, excludeTools: string[], promptText: string): string[] {
  const args = ["--mode", "json", "--model", model, "--approve"];

  if (systemPrompt) {
    args.push("--append-system-prompt", systemPrompt);
  }

  if (excludeTools.length > 0) {
    args.push("--exclude-tools", excludeTools.join(","));
  }

  args.push(promptText);
  return args;
}

function buildResumeArgs(model: string, sessionId: string, promptText: string): string[] {
  return ["--mode", "json", "--model", model, "--session", sessionId, "--approve", promptText];
}

function buildStatefulPromptInput(isFirstCall: boolean, systemPrompt: string, systemReminder: string, messages: Message[]): StatefulPromptInput {
  if (isFirstCall) {
    return {
      systemPrompt,
      systemReminder,
      bootstrapMessages: messages,
      incrementalMessages: [],
    };
  }
  return {
    systemReminder,
    incrementalMessages: messages,
  };
}

/**
 * 将 ACS GuardProfile deny 列表翻译为 pi 的工具名。
 * pi 内置工具：read, bash, edit, write, grep, find, ls。
 */
function translatePiMonoTools(deny: string[]): string[] {
  const result: string[] = [];
  for (const entry of deny) {
    const bashMatch = entry.match(/^Bash\((.+)\)$/);
    if (bashMatch) {
      result.push("bash");
      continue;
    }
    switch (entry) {
      case "Read":
        result.push("read");
        break;
      case "Write":
        result.push("write");
        break;
      case "Edit":
        result.push("edit");
        break;
      // Claude Code 特有工具，pi 无对应概念，跳过
      case "AskUserQuestion":
      case "EnterPlanMode":
      case "ExitPlanMode":
        break;
      default:
        result.push(entry.toLowerCase());
    }
  }
  return [...new Set(result)];
}

function consumePiMonoOutput(state: PiMonoParseState, chunk: string, onEvent: (event: AgentEvent) => void): void {
  state.rawOutput.push(chunk);
  state.buffer += chunk;

  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event: PiMonoEvent = JSON.parse(line);
      processPiMonoEvent(state, event, onEvent);
    } catch (error) {
      log.warn({ error }, "failed to parse pi-mono output line");
    }
  }
}

type PiMonoEventHandler = (state: PiMonoParseState, event: PiMonoEvent, onEvent: (event: AgentEvent) => void) => void;

const PI_MONO_EVENT_HANDLERS: Record<string, PiMonoEventHandler> = {
  session: handleSessionEvent,
  agent_start: (state, _event, onEvent) => emitPiMonoSignal(state, onEvent, "start", "agent_start"),
  agent_end: handleAgentEndEvent,
  turn_start: (state, _event, onEvent) => emitPiMonoSignal(state, onEvent, "turn_started", "turn_start"),
  turn_end: handleTurnEndEvent,
  message_start: () => {},
  message_update: handleMessageUpdateEvent,
  message_end: handleMessageEndEvent,
  tool_execution_start: handleToolExecutionStartEvent,
  tool_execution_end: handleToolExecutionEndEvent,
  error: handleErrorEvent,
};

function processPiMonoEvent(state: PiMonoParseState, event: PiMonoEvent, onEvent: (event: AgentEvent) => void): void {
  const handler = PI_MONO_EVENT_HANDLERS[event.type];
  if (handler) {
    handler(state, event, onEvent);
  }
}

function handleSessionEvent(state: PiMonoParseState, event: PiMonoEvent): void {
  if (event.id && !state.sessionId) {
    state.sessionId = event.id;
  }
}

function handleAgentEndEvent(state: PiMonoParseState, event: PiMonoEvent, onEvent: (event: AgentEvent) => void): void {
  emitPiMonoUsageIfPresent(state, event, onEvent, "agent_end");
  emitPiMonoSignal(state, onEvent, "message_completed", "agent_end");
}

function handleTurnEndEvent(state: PiMonoParseState, event: PiMonoEvent, onEvent: (event: AgentEvent) => void): void {
  emitPiMonoUsageIfPresent(state, event, onEvent, "turn_end");
  emitPiMonoSignal(state, onEvent, "turn_completed", "turn_end");
}

function handleMessageUpdateEvent(state: PiMonoParseState, event: PiMonoEvent, onEvent: (event: AgentEvent) => void): void {
  if (typeof event.error === "string" && event.error) {
    emitPiMonoError(state, event.error, onEvent);
  }
}

function handleMessageEndEvent(state: PiMonoParseState, event: PiMonoEvent, onEvent: (event: AgentEvent) => void): void {
  const text = extractTextFromMessage(event);
  if (text) {
    emitPiMonoEvent(state, onEvent, {
      kind: "text",
      payload: { text, mentions: [] },
      source: { runtime_event_type: "message_end", runtime_message_id: null },
    });
  }
}

function handleToolExecutionStartEvent(state: PiMonoParseState, event: PiMonoEvent, onEvent: (event: AgentEvent) => void): void {
  const toolName = event.tool ?? "unknown";
  const callId = (event.id as string) ?? null;
  emitPiMonoEvent(state, onEvent, {
    kind: "tool_call",
    payload: { tool_name: toolName, call_id: callId ?? "", input: event.input ?? null },
    source: { runtime_event_type: "tool_execution_start", runtime_message_id: null, runtime_call_id: callId },
  });
}

function handleToolExecutionEndEvent(state: PiMonoParseState, event: PiMonoEvent, onEvent: (event: AgentEvent) => void): void {
  const callId = (event.id as string) ?? null;
  emitPiMonoEvent(state, onEvent, {
    kind: "tool_result",
    payload: { call_id: callId ?? "", output: event.output ?? "", is_error: Boolean(event.error) },
    source: { runtime_event_type: "tool_execution_end", runtime_message_id: null, runtime_call_id: callId },
  });
}

function handleErrorEvent(state: PiMonoParseState, event: PiMonoEvent, onEvent: (event: AgentEvent) => void): void {
  const errorMsg = typeof event.error === "string" ? event.error : "Unknown error";
  emitPiMonoError(state, errorMsg, onEvent);
}

function extractTextFromMessage(event: PiMonoEvent): string | null {
  const content = event.message?.content;
  if (!Array.isArray(content)) return null;

  const textParts = content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!);
  return textParts.length > 0 ? textParts.join("") : null;
}

function emitPiMonoUsageIfPresent(
  state: PiMonoParseState,
  event: PiMonoEvent,
  onEvent: (event: AgentEvent) => void,
  runtimeEventType: string,
): void {
  const usageData = event.usage ?? event.tokens;
  if (usageData == null) return;
  const usage = usageDetailFromPiMono(usageData, state.contextWindow);
  if (usage) {
    emitPiMonoEvent(state, onEvent, buildRuntimeUsageSignal(usage, runtimeEventType).event);
  }
}

function emitPiMonoSignal(
  state: PiMonoParseState,
  onEvent: (event: AgentEvent) => void,
  signalType: LifecycleSignal,
  runtimeEventType: string,
): void {
  emitPiMonoEvent(state, onEvent, {
    kind: "signal",
    payload: { signal_type: signalType, data: null },
    source: { runtime_event_type: runtimeEventType, runtime_message_id: null },
  });
}

function emitPiMonoError(
  state: PiMonoParseState,
  errorMsg: string,
  onEvent: (event: AgentEvent) => void,
): void {
  state.errors.push(errorMsg);
  emitPiMonoEvent(state, onEvent, {
    kind: "error",
    payload: { message: errorMsg },
    source: { runtime_event_type: "error", runtime_message_id: null },
  });
}

function formatPiMonoDiagnostics(stderr: string, state: PiMonoParseState): string {
  const parts = [
    stderr ? `stderr: ${truncateDiagnostic(stderr)}` : null,
    state.rawOutput.length > 0 ? `rawOutput: ${truncateDiagnostic(state.rawOutput.join(""))}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}

function truncateDiagnostic(text: string): string {
  const maxLength = 500;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function emitPiMonoEvent(state: PiMonoParseState, onEvent: (event: AgentEvent) => void, event: AgentEvent["event"]): void {
  if (event.kind !== "signal") state.outputEventCount += 1;
  onEvent({ type: "message_event", event });
}

function flushPiMonoOutput(state: PiMonoParseState, onEvent: (event: AgentEvent) => void): void {
  if (state.buffer.trim()) {
    try {
      const event: PiMonoEvent = JSON.parse(state.buffer);
      processPiMonoEvent(state, event, onEvent);
    } catch (error) {
      log.warn({ error }, "failed to parse buffered pi-mono output");
    }
  }
}

export const agent = new PiMonoAgent();
