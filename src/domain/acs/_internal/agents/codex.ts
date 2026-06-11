import { spawn } from "child_process";
import path from "path";
import type { AgentRuntimePort } from "../../port";
import type { FirstCallRequest, ResumeRequest, AgentEvent, InvokeResult, InvokeOptions, GuardProfile, Message } from "../../model";
import { manageInvocationProcess } from "../utils/managed-process";
import { renderStatefulPrompt, type StatefulPromptInput } from "../utils/stateful-prompt-format";
import { buildRuntimeUsageSignal, usageDetailFromCodexUsage } from "../utils/runtime-usage";
import { ensureMcpServers } from "../utils/mcp-config";
import { ensureSkillSymlinks } from "../utils/skill-symlinks";

interface CodexEvent {
  type: string;
  thread_id?: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  };
  error?: { message: string };
  usage?: unknown;
  [key: string]: unknown;
}

interface CodexParseState {
  buffer: string;
  rawOutput: string[];
  textChunks: string[];
  outputEventCount: number;
  threadId: string | null;
  model: string | null;
  contextWindow: number | null;
  completed: boolean;
  failed: boolean;
}

/**
 * Codex 适配器。
 *
 * 有状态 agent：首次调用注入完整配置，后续调用通过 thread_id resume。
 * System prompt 通过 -c developer_instructions 原生注入。
 */
export class CodexAgent implements AgentRuntimePort {
  readonly name = "codex";
  private static readonly DEFAULT_MODEL = "claude-opus-4";

  /**
   * 首次调用：注入完整配置（capabilities + guard profile + prompt）。
   */
  async invokeFirstCall(
    request: FirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    // 注入 capabilities（文件系统级别）
    writeCodexGuardConfig(request.guard_profile.deny, request.workspaceRoot);
    ensureMcpServers(request.capabilities.mcpServers, request.workspaceRoot, "codex");
    ensureSkillSymlinks(request.workspaceRoot, request.capabilities.skills);

    // 构建首次调用的 CLI args
    const model = options.model ?? CodexAgent.DEFAULT_MODEL;
    const statefulInput = buildStatefulPromptInput(true, request.prompt.systemPrompt, request.prompt.systemReminder, request.messages);
    const promptText = renderStatefulPrompt(statefulInput, { skipSystemPrompt: false });
    const args = buildFirstCallArgs(model, promptText, request.prompt.systemPrompt);

    // Spawn 进程
    const proc = this.spawn(args, request.workspaceRoot, options);

    // 发送 prompt
    this.writePrompt(proc, promptText);

    // 处理输出
    return this.processOutput(proc, onEvent, options, null);
  }

  /**
   * 后续调用：只传 messages + threadId，不注入配置。
   */
  async invokeResume(
    request: ResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    // 构建 resume 的 CLI args
    const model = options.model ?? CodexAgent.DEFAULT_MODEL;
    const statefulInput = buildStatefulPromptInput(false, "", request.systemReminder, request.messages);
    const promptText = renderStatefulPrompt(statefulInput, { skipSystemPrompt: true });
    const args = buildResumeArgs(model, request.sessionId);

    // Spawn 进程
    const proc = this.spawn(args, request.workspaceRoot, options);

    // 发送 prompt
    this.writePrompt(proc, promptText);

    // 处理输出
    return this.processOutput(proc, onEvent, options, request.sessionId);
  }

  // ── 通用辅助方法 ──────────────────────────────────────────────────────

  /** Spawn Codex 进程 */
  private spawn(args: string[], workspaceRoot: string, options: InvokeOptions) {
    return spawn("codex", args, {
      cwd: workspaceRoot,
      env: { ...process.env, CODEX_HOME: path.join(workspaceRoot, ".codex"), ...options.contextEnv },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
  }

  /** 通过 stdin 发送 prompt */
  private writePrompt(proc: ReturnType<typeof spawn>, promptText: string): void {
    if (proc.stdin) {
      proc.stdin.write(promptText);
      proc.stdin.end();
    }
  }

  /** 处理进程输出，返回 InvokeResult */
  private async processOutput(
    proc: ReturnType<typeof spawn>,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions,
    existingThreadId: string | null,
  ): Promise<InvokeResult> {
    const processController = manageInvocationProcess({
      proc,
      agentName: "Codex",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    let stderr = "";
    const state = createParseState(existingThreadId, options.model ?? CodexAgent.DEFAULT_MODEL, options.contextWindow ?? null);

    proc.stdout?.on("data", (chunk: Buffer) => {
      consumeCodexOutput(state, chunk.toString(), onEvent);
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

    flushCodexOutput(state, onEvent);
    await processController.throwIfStopped();

    if (state.failed || exitCode !== 0) {
      const errorMsg = stderr || state.rawOutput.join("");
      throw new Error(`codex exec failed (exit ${exitCode}): ${errorMsg}`);
    }

    if (state.outputEventCount === 0) {
      const maxLen = 500;
      const truncated = (text: string) => text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
      const diagnosticInfo = [
        stderr ? `stderr: ${truncated(stderr)}` : null,
        state.rawOutput.length > 0 ? `rawOutput: ${truncated(state.rawOutput.join(""))}` : null,
      ].filter(Boolean).join("; ");
      const suffix = diagnosticInfo ? ` (${diagnosticInfo})` : "";
      throw new Error(`codex returned no output events${suffix}`);
    }

    return { sessionId: state.threadId, waitForStop: () => processController.waitForStop() };
  }
}

// ═══════════════════════════════════════════════════════════
// 内部辅助函数
// ═══════════════════════════════════════════════════════════

function buildFirstCallArgs(model: string, promptText: string, systemPrompt: string): string[] {
  const args = ["exec", "--json", "-m", model];
  if (systemPrompt) {
    args.push("-c", `developer_instructions=${systemPrompt}`);
  }
  return args;
}

function buildResumeArgs(model: string, threadId: string): string[] {
  return ["exec", "resume", "--json", threadId, "-"];
}

function buildStatefulPromptInput(isFirstCall: boolean, systemPrompt: string, systemReminder: string, messages: Message[]): StatefulPromptInput {
  if (isFirstCall) {
    const bootstrapMessages = dropLatestUserMessage(messages);
    return {
      systemPrompt,
      systemReminder,
      bootstrapMessages,
      incrementalMessages: [],
    };
  }
  return {
    systemReminder,
    incrementalMessages: messages,
  };
}

function dropLatestUserMessage(messages: Message[]): Message[] {
  if (messages.length === 0) return [];
  const lastIdx = messages.length - 1;
  if (messages[lastIdx].role === "user") {
    return messages.slice(0, lastIdx);
  }
  return messages;
}

function writeCodexGuardConfig(deny: string[], workspaceRoot: string): void {
  // 写入 .codex/config.toml 的 sandbox_mode 配置
}

function createParseState(threadId: string | null, model: string, contextWindow: number | null): CodexParseState {
  return {
    buffer: "",
    rawOutput: [],
    textChunks: [],
    outputEventCount: 0,
    threadId,
    model,
    contextWindow,
    completed: false,
    failed: false,
  };
}

function consumeCodexOutput(state: CodexParseState, chunk: string, onEvent: (event: AgentEvent) => void): void {
  state.rawOutput.push(chunk);
  state.buffer += chunk;

  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event: CodexEvent = JSON.parse(line);
      processCodexEvent(state, event, onEvent);
    } catch {}
  }
}

function processCodexEvent(state: CodexParseState, event: CodexEvent, onEvent: (event: AgentEvent) => void): void {
  if (event.thread_id && !state.threadId) {
    state.threadId = event.thread_id;
  }

  if (event.type === "turn.completed" && event.message) {
    for (const part of event.message.content) {
      if (part.type === "text" && part.text) {
        state.textChunks.push(part.text);
        state.outputEventCount++;
        onEvent({
          type: "message_event",
          event: {
            kind: "text",
            payload: { text: part.text, mentions: [] },
            source: { runtime_event_type: "turn.completed", runtime_message_id: null, runtime_call_id: null },
          },
        });
      }
    }

    if (event.usage) {
      onEvent(buildRuntimeUsageSignal(usageDetailFromCodexUsage(event.usage), "turn.completed"));
    }
  }

  if (event.type === "turn.failed") {
    state.failed = true;
    const errorMsg = event.error?.message ?? "Unknown error";
    onEvent({
      type: "message_event",
      event: {
        kind: "error",
        payload: { message: errorMsg },
        source: { runtime_event_type: "turn.failed", runtime_message_id: null },
      },
    });
    onEvent({
      type: "message_event",
      event: {
        kind: "signal",
        payload: { signal_type: "message_failed", data: { error: errorMsg } },
        source: { runtime_event_type: "turn.failed", runtime_message_id: null },
      },
    });
  }

  if (event.type === "error" && typeof event.message === "string") {
    onEvent({
      type: "message_event",
      event: {
        kind: "error",
        payload: { message: event.message },
        source: { runtime_event_type: "error", runtime_message_id: null },
      },
    });
  }
}

function flushCodexOutput(state: CodexParseState, onEvent: (event: AgentEvent) => void): void {
  if (state.buffer.trim()) {
    try {
      const event: CodexEvent = JSON.parse(state.buffer);
      processCodexEvent(state, event, onEvent);
    } catch {}
  }
}

export const agent = new CodexAgent();
