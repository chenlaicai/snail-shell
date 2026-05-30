import { spawn } from "child_process";
import * as path from "path";
import type {
  AgentEvent,
  AgentInvocationOptions,
  AgentInvocationResult,
  SnailRuntime,
  SnailRuntimeMessageInput,
  StatefulAgentInvoker,
  StatefulInvocationInput,
} from "./interface";
import { manageInvocationProcess } from "./managed-process";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages } from "./prompt-mapper";
import { logger } from "../logger";
import { buildRuntimeUsageSignal, usageDetailFromCodexUsage } from "./runtime-usage";
import { renderStatefulPrompt } from "./stateful-prompt-format";
import { writeCodexGuardConfig } from "./guard-config";
import { ensureMcpServers } from "./mcp-config";
import { ensureSkillSymlinks } from "./skill-symlinks";

// Codex JSON event types observed from actual CLI output:
// - {"type":"thread.started","thread_id":"..."}
// - {"type":"turn.started"}
// - {"type":"turn.completed","message":{"role":"assistant","content":[...]}}
// - {"type":"turn.failed","error":{"message":"..."}}
// - {"type":"error","message":"..."}

interface CodexEvent {
  type: string;
  thread_id?: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  };
  error?: {
    message: string;
  };
  usage?: unknown;
  [key: string]: unknown;
}

export interface CodexParseState {
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

export class CodexAgent implements SnailRuntime, StatefulAgentInvoker {
  readonly name = "codex";
  readonly runtime = "codex-cli" as const;
  private static readonly DEFAULT_MODEL = "claude-opus-4";

  private codexCapWarned = false;

  async invokeMessage(input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions): Promise<AgentInvocationResult> {
    // 将 ACS GuardProfile 翻译为 Codex config.toml（CODEX_HOME 指向 .codex/ 目录加载）
    writeCodexGuardConfig(input.capability.guardProfile, input.workspaceRoot);

    // 消费 ACP mcpServers：确保 agent CWD 的 .mcp.json 包含 MCP server 配置
    // Codex 以 workspaceRoot 作为 CWD 启动（codex.ts:209），.mcp.json 必须写入同一目录
    // 同时写入 Codex 全局配置 ~/.codex/config.toml
    ensureMcpServers(input.capability.mcpServers, input.workspaceRoot, "codex");

    // 将 ACS skills 暴露为 Codex 原生 skill 目录（.agents/skills/）
    // Codex 启动时自动扫描该目录，listing 注入 developer prompt，agent 通过 $SkillName 引用
    ensureSkillSymlinks(input.projectRoot, input.capability.skills);

    // Codex 能力缺口告警（仅首次）：
    // database/filesystem/git/network 的 GuardProfile domain 仅通过 sandbox_mode（filesystem）生效，
    // 无法执行数据库 CLI 拦截、git 危险操作拦截等参数级语义检查（无 PreToolUse hooks）。
    if (!this.codexCapWarned) {
      this.codexCapWarned = true;
      logger.warn("Codex GuardProfile 仅 sandbox_mode 生效（filesystem domain），database/git/network domain 无参数级拦截（不支持 PreToolUse hooks）");
    }

    // Codex uses thread-based sessions (thread_id) rather than sessionId.
    // On first message we bootstrap with full context; on subsequent messages we resume the thread.
    const threadId = input.externalSessionId;
    let bootstrap = threadId ? null : buildStatefulBootstrap(input);
    if (bootstrap) {
      bootstrap = {
        ...bootstrap,
        systemPrompt: input.capability.systemPrompt,
      };
    }
    return this.invokeStateful(
      {
        sessionId: threadId,
        bootstrap,
        incrementalMessages: buildStatefulIncrementalMessages(input),
        systemReminder: input.capability.systemReminder,
      },
      onEvent,
      options,
      input.workspaceRoot,
    );
  }

  async invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options: AgentInvocationOptions = {},
    workspaceRoot?: string,
  ): Promise<AgentInvocationResult> {
    const model = options.model ?? CodexAgent.DEFAULT_MODEL;
    const prompt = buildPrompt(input);
    const args = buildArgs(model, input);

    const { exitCode, stderr, state, waitForStop } = await executeCodex({ args, threadId: input.sessionId, prompt, model, onEvent, options, workspaceRoot });

    if (state.failed || exitCode !== 0) {
      const errorMsg = stderr || state.rawOutput.join("");
      throw new Error(`codex exec failed (exit ${exitCode}): ${errorMsg}`);
    }

    assertCodexOutputEvents(state, stderr);
    return { sessionId: state.threadId, waitForStop };
  }
}

function createParseState(threadId: string | null, model: string | null = null, contextWindow: number | null = null): CodexParseState {
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

function buildPrompt(input: StatefulInvocationInput): string {
  // Codex 通过 -c developer_instructions 原生注入 systemPrompt，
  // prompt 文本中跳过 ## 当前任务上下文 段落避免重复。
  return renderStatefulPrompt(input, { skipSystemPrompt: true });
}

export function buildArgs(model: string, input: StatefulInvocationInput): string[] {
  // Codex CLI actual command structure:
  // - New session: codex exec --json --model <model> -c 'developer_instructions=...' -
  // - Resume session: codex exec resume --json <thread_id> -
  // The "-" argument explicitly tells Codex to read prompt from stdin
  //
  // Codex sandbox 默认开启（macOS Seatbelt / Linux Landlock+seccomp），
  // 文件写入限制在 cwd + /tmp，网络默认禁止。不再使用
  // --dangerously-bypass-approvals-and-sandbox 跳过安全机制。
  // Snail Shell 通过 ACS GuardProfile 控制策略，不在 adapter 层跳过审批。

  if (input.sessionId) {
    // Resume existing thread
    // Codex CLI: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
    // SESSION_ID is a positional argument, not --session flag
    return [
      "exec",
      "resume",
      "--json",
      input.sessionId,
      "-",
    ];
  } else {
    // Start new persistent thread
    const args = [
      "exec",
      "--json",
      "--model",
      model,
    ];

    // Codex 原生 developer_instructions 注入：通过 -c 传递 systemPrompt，
    // 与 stdin 对话内容分离，模型能区分系统规则和对话消息。
    const systemPrompt = input.bootstrap?.systemPrompt?.trim();
    if (systemPrompt) {
      args.push("-c", `developer_instructions=${escapeTomlBasicString(systemPrompt)}`);
    }

    args.push("-");
    return args;
  }
}

/**
 * 将字符串转义为 TOML 基本字符串（双引号）。
 * spawn() 不经过 shell，无需 shell 转义；只需处理 TOML 特殊字符。
 */
function escapeTomlBasicString(value: string): string {
  return '"' + value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t") + '"';
}

/**
 * 构建 Codex spawn 所需的环境变量。
 * CODEX_HOME 指向 worktree 的 .codex/ 目录，Codex CLI 从 $CODEX_HOME/config.toml 加载配置。
 */
export function buildCodexSpawnEnv(workspaceRoot?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CODEX_HOME: path.join(workspaceRoot ?? process.cwd(), ".codex"),
  };
}

async function executeCodex(input: { args: string[]; threadId: string | null; prompt: string; model: string; onEvent: (event: AgentEvent) => void; options?: AgentInvocationOptions; workspaceRoot?: string }): Promise<{ exitCode: number | null; stderr: string; state: CodexParseState; waitForStop: () => Promise<void> }> {
  const { args, threadId, prompt, model, onEvent, options = {}, workspaceRoot } = input;
  const cwd = workspaceRoot ?? process.cwd();
  const proc = spawn("codex", args, {
    cwd,
    env: buildCodexSpawnEnv(workspaceRoot),
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  const processController = manageInvocationProcess({ proc, agentName: "Codex", signal: options.signal, invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000 });

  // Send prompt via stdin
  if (proc.stdin) {
    proc.stdin.write(prompt);
    proc.stdin.end();
  }

  let stderr = "";
  const state = createParseState(threadId, model, options.contextWindow ?? null);

  proc.stdout?.on("data", (chunk: Buffer) => {
    consumeCodexOutput(state, chunk.toString(), onEvent);
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    logger.debug("Codex stderr", { chunk: text });
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
  return { exitCode, stderr, state, waitForStop: () => processController.waitForStop() };
}

export function consumeCodexOutput(
  state: CodexParseState,
  chunk: string,
  onEvent: (event: AgentEvent) => void
): void {
  state.rawOutput.push(chunk);
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    handleCodexLine(state, line, onEvent);
  }
}

export function flushCodexOutput(state: CodexParseState, onEvent: (event: AgentEvent) => void): void {
  if (state.buffer.trim()) {
    handleCodexLine(state, state.buffer, onEvent);
  }
  state.buffer = "";
}

export function collectCodexText(state: CodexParseState): string {
  assertCodexOutputEvents(state);
  return state.textChunks.join("");
}

function assertCodexOutputEvents(state: CodexParseState, stderr?: string): void {
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
}

function handleCodexLine(
  state: CodexParseState,
  line: string,
  onEvent: (event: AgentEvent) => void
): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let event: CodexEvent;
  try {
    event = JSON.parse(trimmed) as CodexEvent;
  } catch {
    // Not JSON, ignore (could be stderr mixed in)
    return;
  }

  processCodexEvent(event, state, onEvent);
}

function processCodexEvent(
  event: CodexEvent,
  state: CodexParseState,
  onEvent: (event: AgentEvent) => void
): void {
  // Extract thread_id from thread.started event
  if (event.type === "thread.started" && event.thread_id) {
    /**
     * Codex thread ids are runtime session anchors, not Snail Shell messages.
     * Keeping them out of MessageEvent preserves the one-message-entity model while still allowing resume.
     */
    state.threadId = event.thread_id;
    logger.debug("Codex thread started", { threadId: state.threadId });
    return;
  }

  if (event.type === "turn.started") {
    emitCodexMessageEvent(state, onEvent, { kind: "signal", payload: { type: "turn_started", reason: null, detail: null }, source: { runtime_event_type: "turn.started" } });
    return;
  }

  // Handle turn completion
  if (event.type === "turn.completed" && event.message) {
    state.completed = true;
    extractTextFromMessage(event.message, state, onEvent);
    emitCodexRuntimeUsage(event, state, onEvent);
    emitCodexMessageEvent(state, onEvent, { kind: "signal", payload: { type: "turn_completed", reason: null, detail: null }, source: { runtime_event_type: "turn.completed" } });
    return;
  }

  // Handle turn failure
  if (event.type === "turn.failed") {
    handleTurnFailure(event, state, onEvent);
    return;
  }

  // Handle error events
  if (event.type === "error" && typeof event.message === "string") {
    logger.warn("Codex error event", { message: event.message });
    emitCodexMessageEvent(state, onEvent, { kind: "error", payload: { source: "runtime", message: event.message, detail: null }, source: { runtime_event_type: "error" } });
  }
}

function handleTurnFailure(
  event: CodexEvent,
  state: CodexParseState,
  onEvent: (event: AgentEvent) => void
): void {
  state.failed = true;
  const errorMsg = event.error?.message || "Turn failed";
  logger.error("Codex turn failed", { error: errorMsg });
  emitCodexMessageEvent(state, onEvent, { kind: "error", payload: { source: "runtime", message: errorMsg, detail: null }, source: { runtime_event_type: "turn.failed" } });
  onEvent({ type: "message_failure", error: errorMsg });
}

function extractTextFromMessage(
  message: { role: string; content: Array<{ type: string; text?: string; [key: string]: unknown }> },
  state: CodexParseState,
  onEvent: (event: AgentEvent) => void
): void {
  for (const block of message.content) {
    if (block.type === "text" && block.text) {
      state.textChunks.push(block.text);
      emitCodexMessageEvent(state, onEvent, { kind: "text", payload: { text: block.text, mentions: [] }, source: { runtime_event_type: "item.completed" } });
    }
  }
}

function emitCodexRuntimeUsage(event: CodexEvent, state: CodexParseState, onEvent: (event: AgentEvent) => void): void {
  const detail = usageDetailFromCodexUsage(event.usage, state.contextWindow);
  if (!detail) return;
  emitCodexMessageEvent(state, onEvent, buildRuntimeUsageSignal(detail, "turn.completed"));
}

function emitCodexMessageEvent(state: CodexParseState, onEvent: (event: AgentEvent) => void, event: Extract<AgentEvent, { type: "message_event" }>["event"]): void {
  if (event.kind !== "signal" && event.kind !== "start") state.outputEventCount += 1;
  onEvent({ type: "message_event", event });
}
