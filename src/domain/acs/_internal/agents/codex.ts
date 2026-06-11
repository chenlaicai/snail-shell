import { spawn } from "child_process";
import path from "path";
import type { AgentRuntimePort } from "../../port";
import type { AgentRequest, AgentEvent, InvokeResult, InvokeOptions, Message } from "../../model";
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
 * 有状态 agent：首次调用通过 stdin 传递完整 prompt，
 * 后续调用通过 thread_id resume。
 * System prompt 通过 -c developer_instructions 原生注入。
 */
export class CodexAgent implements AgentRuntimePort {
  readonly name = "codex";
  private static readonly DEFAULT_MODEL = "claude-opus-4";

  async invoke(
    request: AgentRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const { prompt, capabilities, security, messages, workspaceRoot, sessionId } = resolveRequest(request);

    // 注入 capabilities（首次调用）
    if (request.kind === "first_call") {
      writeCodexGuardConfig(security.deny, workspaceRoot);
      ensureMcpServers(capabilities.mcpServers, workspaceRoot, "codex");
      ensureSkillSymlinks(workspaceRoot, capabilities.skills);
    }

    const model = options.model ?? CodexAgent.DEFAULT_MODEL;
    const statefulInput = buildStatefulPromptInput(request, prompt.systemPrompt, prompt.systemReminder, messages);
    const promptText = renderStatefulPrompt(statefulInput, { skipSystemPrompt: !!sessionId });
    const args = buildArgs(model, sessionId, promptText, request.kind === "first_call" ? prompt.systemPrompt : undefined);

    const cwd = workspaceRoot;
    const proc = spawn("codex", args, {
      cwd,
      env: { ...process.env, CODEX_HOME: path.join(cwd, ".codex"), ...options.contextEnv },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    const processController = manageInvocationProcess({
      proc,
      agentName: "Codex",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    // Send prompt via stdin
    if (proc.stdin) {
      proc.stdin.write(promptText);
      proc.stdin.end();
    }

    let stderr = "";
    const state = createParseState(sessionId, model, options.contextWindow ?? null);

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

function resolveRequest(request: AgentRequest): {
  prompt: { systemPrompt: string; systemReminder: string; mcpContext: string };
  capabilities: { skills: any[]; mcpServers: any[] };
  security: { deny: string[]; allow: string[] };
  messages: Message[];
  workspaceRoot: string;
  sessionId: string | null;
} {
  if (request.kind === "first_call") {
    return {
      prompt: request.prompt,
      capabilities: request.capabilities,
      security: request.security,
      messages: request.messages,
      workspaceRoot: request.workspaceRoot,
      sessionId: null,
    };
  }
  return {
    prompt: { systemPrompt: "", systemReminder: request.systemReminder, mcpContext: "" },
    capabilities: { skills: [], mcpServers: [] },
    security: { deny: [], allow: [] },
    messages: request.messages,
    workspaceRoot: request.workspaceRoot,
    sessionId: request.sessionId,
  };
}

function buildStatefulPromptInput(request: AgentRequest, systemPrompt: string, systemReminder: string, messages: Message[]): StatefulPromptInput {
  if (request.kind === "first_call") {
    // Bootstrap: systemPrompt + 历史消息（去掉最后一条 user 消息，它作为增量发送）
    const bootstrapMessages = dropLatestUserMessage(messages);
    return {
      systemPrompt,
      systemReminder,
      bootstrapMessages,
      incrementalMessages: [],
    };
  }
  // Resume: 仅增量消息
  return {
    systemReminder,
    incrementalMessages: messages,
  };
}

function dropLatestUserMessage(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      return messages.filter((_, idx) => idx !== i);
    }
  }
  return [...messages];
}

function buildArgs(model: string, sessionId: string | null, prompt: string, systemPrompt?: string): string[] {
  if (sessionId) {
    return ["exec", "resume", "--json", sessionId, "-"];
  }
  const args = ["exec", "--json", "--model", model];
  if (systemPrompt?.trim()) {
    args.push("-c", `developer_instructions=${escapeTomlBasicString(systemPrompt.trim())}`);
  }
  args.push("-");
  return args;
}

function escapeTomlBasicString(value: string): string {
  return '"' + value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t") + '"';
}

function writeCodexGuardConfig(deny: string[], workspaceRoot: string): void {
  const fs = require("fs") as typeof import("fs");
  const codexDir = path.join(workspaceRoot, ".codex");
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }
  const configPath = path.join(codexDir, "config.toml");
  const hasRestrictiveFilesystem = deny.some((p) => p.includes("rm -rf") || p.includes("chmod"));
  const sandbox = hasRestrictiveFilesystem ? "read-only" : "workspace-write";
  const content = [
    `# Codex 配置 — Snail Shell ACS 翻译生成`,
    ``,
    `sandbox_mode = "${sandbox}"`,
    ``,
  ].join("\n");

  if (fs.existsSync(configPath)) {
    const existing = fs.readFileSync(configPath, "utf-8");
    const lines = existing.split("\n");
    const keyRe = /^sandbox_mode\s*=.+$/;
    const idx = lines.findIndex((l) => keyRe.test(l));
    if (idx !== -1) {
      lines[idx] = `sandbox_mode = "${sandbox}"`;
      fs.writeFileSync(configPath, lines.join("\n"));
      return;
    }
    fs.writeFileSync(configPath, existing.trimEnd() + "\n" + content);
  } else {
    fs.writeFileSync(configPath, content);
  }
}

function createParseState(threadId: string | null, model: string | null, contextWindow: number | null): CodexParseState {
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
    handleCodexLine(state, line, onEvent);
  }
}

function flushCodexOutput(state: CodexParseState, onEvent: (event: AgentEvent) => void): void {
  if (state.buffer.trim()) {
    handleCodexLine(state, state.buffer, onEvent);
  }
  state.buffer = "";
}

function handleCodexLine(state: CodexParseState, line: string, onEvent: (event: AgentEvent) => void): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event: CodexEvent;
  try {
    event = JSON.parse(trimmed) as CodexEvent;
  } catch {
    return;
  }
  processCodexEvent(event, state, onEvent);
}

function processCodexEvent(event: CodexEvent, state: CodexParseState, onEvent: (event: AgentEvent) => void): void {
  if (event.type === "thread.started" && event.thread_id) {
    state.threadId = event.thread_id;
    return;
  }

  if (event.type === "turn.started") {
    emitCodexEvent(state, onEvent, {
      kind: "signal",
      payload: { signal_type: "turn_started", data: null },
      source: { runtime_event_type: "turn.started", runtime_message_id: null },
    });
    return;
  }

  if (event.type === "turn.completed" && event.message) {
    state.completed = true;
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        state.textChunks.push(block.text);
        emitCodexEvent(state, onEvent, {
          kind: "text",
          payload: { text: block.text, mentions: [] },
          source: { runtime_event_type: "item.completed", runtime_message_id: null },
        });
      }
    }
    const usage = usageDetailFromCodexUsage(event.usage, state.contextWindow);
    if (usage) emitCodexEvent(state, onEvent, buildRuntimeUsageSignal(usage, "turn.completed").event);
    emitCodexEvent(state, onEvent, {
      kind: "signal",
      payload: { signal_type: "turn_completed", data: null },
      source: { runtime_event_type: "turn.completed", runtime_message_id: null },
    });
    return;
  }

  if (event.type === "turn.failed") {
    state.failed = true;
    const errorMsg = event.error?.message || "Turn failed";
    emitCodexEvent(state, onEvent, {
      kind: "error",
      payload: { message: errorMsg },
      source: { runtime_event_type: "turn.failed", runtime_message_id: null },
    });
    onEvent({
      type: "message_event",
      event: {
        kind: "message_failure",
        payload: { error: errorMsg },
        source: { runtime_event_type: "turn.failed", runtime_message_id: null },
      },
    });
    return;
  }

  if (event.type === "error" && typeof event.message === "string") {
    emitCodexEvent(state, onEvent, {
      kind: "error",
      payload: { message: event.message },
      source: { runtime_event_type: "error", runtime_message_id: null },
    });
  }
}

function emitCodexEvent(state: CodexParseState, onEvent: (event: AgentEvent) => void, event: AgentEvent["event"]): void {
  if (event.kind !== "signal") state.outputEventCount += 1;
  onEvent({ type: "message_event", event });
}

export const agent = new CodexAgent();
