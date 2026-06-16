import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { AgentRuntimePort } from "@infra/acs/port";
import type { FirstCallRequest, ResumeRequest, AgentEvent, InvokeResult, InvokeOptions, Message } from "@infra/acs/model";
import { manageInvocationProcess } from "@infra/acs/_internal/utils/managed-process";
import { renderStatefulPrompt, type StatefulPromptInput } from "@infra/acs/_internal/utils/stateful-prompt-format";
import { buildRuntimeUsageSignal, usageDetailFromOpenCodeTokens } from "@infra/acs/_internal/utils/runtime-usage";
import { ensureMcpServers } from "@infra/acs/_internal/utils/mcp-config";
import { ensureSkillSymlinks } from "@infra/acs/_internal/utils/skill-symlinks";

const OPENCODE_ENV_KEYS = [
  "OPENCODE", "OPENCODE_CLIENT", "OPENCODE_EXPERIMENTAL_FILEWATCHER",
  "OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", "OPENCODE_PID", "OPENCODE_PROCESS_ROLE",
  "OPENCODE_RUN_ID", "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME",
] as const;

interface OpenCodeEvent {
  type: string;
  sessionID?: string;
  part?: { type: string; sessionID?: string; text?: string; tool_use?: { name: string; id: string; input: unknown }; tool_result?: { call_id: string; output: string; is_error: boolean } };
  tokens?: unknown;
  error?: { message?: string; code?: string } | string;
  [key: string]: unknown;
}

interface OpenCodeParseState {
  buffer: string;
  outputEventCount: number;
  sessionId: string | null;
  contextWindow: number | null;
  errors: string[];
  rawOutput: string[];
}

/**
 * OpenCode 适配器。
 *
 * 有状态 agent：首次调用注入完整配置，后续调用通过 --session resume。
 */
export class OpenCodeAgent implements AgentRuntimePort {
  readonly name = "opencode";
  private static readonly DEFAULT_MODEL = "my-geek/gpt-5.5";

  /**
   * 首次调用：注入完整配置（capabilities + guard profile + prompt）。
   */
  async invokeFirstCall(
    request: FirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    // 注入 capabilities（文件系统级别）
    writeOpenCodeGuardConfig(request.guard_profile.deny, request.workspacePath);
    ensureMcpServers(request.capabilities.mcpServers, request.workspacePath, "opencode");
    ensureSkillSymlinks(request.workspacePath, request.capabilities.skills);

    // 构建首次调用的 CLI args
    const model = options.model ?? OpenCodeAgent.DEFAULT_MODEL;
    const statefulInput = buildStatefulPromptInput(true, request.prompt.systemPrompt, request.prompt.systemReminder, request.messages);
    const promptText = renderStatefulPrompt(statefulInput, { skipSystemPrompt: false });
    const args = buildFirstCallArgs(model, promptText);

    // Spawn 进程
    const proc = this.spawn(args, request.workspacePath, options);

    // 处理输出
    return this.processOutput(proc, onEvent, options, null);
  }

  /**
   * 后续调用：只传 messages + sessionId，不注入配置。
   */
  async invokeResume(
    request: ResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    // 构建 resume 的 CLI args
    const model = options.model ?? OpenCodeAgent.DEFAULT_MODEL;
    const statefulInput = buildStatefulPromptInput(false, "", request.systemReminder, request.messages);
    const promptText = renderStatefulPrompt(statefulInput, { skipSystemPrompt: false });
    const args = buildResumeArgs(model, request.sessionId, promptText);

    // Spawn 进程
    const proc = this.spawn(args, request.workspacePath, options);

    // 处理输出
    return this.processOutput(proc, onEvent, options, request.sessionId);
  }

  // ── 通用辅助方法 ──────────────────────────────────────────────────────

  /** Spawn OpenCode 进程 */
  private spawn(args: string[], workspacePath: string, options: InvokeOptions) {
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const key of OPENCODE_ENV_KEYS) {
      delete env[key];
    }
    if (options.contextEnv) {
      Object.assign(env, options.contextEnv);
    }

    return spawn("opencode", args, {
      cwd: workspacePath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
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
      agentName: "OpenCode",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    let stderr = "";
    let stopRequested = false;
    const state: OpenCodeParseState = {
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
      consumeOpenCodeOutput(state, chunk.toString(), onEvent);
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

    flushOpenCodeOutput(state, onEvent);
    await processController.throwIfStopped();

    if (exitCode !== 0) {
      const errorMsg = stderr || "Unknown error";
      throw new Error(`opencode failed (exit ${exitCode}): ${errorMsg}`);
    }

    if (state.errors.length > 0) {
      throw new Error(`opencode failed: ${state.errors.join("; ")}`);
    }

    if (state.outputEventCount === 0) {
      throw new Error(`opencode returned no output events${formatOpenCodeDiagnostics(stderr, state)}`);
    }

    return { sessionId: state.sessionId, waitForStop: () => processController.waitForStop() };
  }
}

// ═══════════════════════════════════════════════════════════
// 内部辅助函数
// ═══════════════════════════════════════════════════════════

function buildFirstCallArgs(model: string, promptText: string): string[] {
  return ["run", "--format", "json", "--model", model, promptText];
}

function buildResumeArgs(model: string, sessionId: string, promptText: string): string[] {
  return ["run", "--format", "json", "--model", model, "--session", sessionId, promptText];
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

function writeOpenCodeGuardConfig(deny: string[], workspacePath: string): void {
  const configPath = path.join(workspacePath, "opencode.json");
  let config: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      console.warn(`[acs] ${configPath} 解析失败，保留原文件内容不变`);
      return;
    }
  }

  config.$schema = "https://opencode.ai/config.json";
  config.permission = translateOpenCodePermission(deny);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function translateOpenCodePermission(deny: string[]): Record<string, unknown> {
  const permission: Record<string, unknown> = { "*": "allow" };
  const bashRules: Record<string, string> = { "*": "allow" };

  for (const entry of deny) {
    const bashMatch = entry.match(/^Bash\((.+)\)$/);
    if (bashMatch) {
      bashRules[bashMatch[1].replace(/:\*$/, "*").replace(/:$/, "")] = "deny";
      continue;
    }

    switch (entry) {
      case "AskUserQuestion":
        permission.question = "deny";
        break;
      case "EnterPlanMode":
      case "ExitPlanMode":
        break;
      default:
        permission[entry.toLowerCase()] = "deny";
    }
  }

  if (Object.keys(bashRules).length > 1) {
    permission.bash = bashRules;
  }

  return permission;
}

function consumeOpenCodeOutput(state: OpenCodeParseState, chunk: string, onEvent: (event: AgentEvent) => void): void {
  state.rawOutput.push(chunk);
  state.buffer += chunk;

  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event: OpenCodeEvent = JSON.parse(line);
      processOpenCodeEvent(state, event, onEvent);
    } catch (error) {
      console.warn("[acs] failed to parse OpenCode output line:", error);
    }
  }
}

function processOpenCodeEvent(state: OpenCodeParseState, event: OpenCodeEvent, onEvent: (event: AgentEvent) => void): void {
  const sessionId = event.sessionID ?? event.part?.sessionID;
  if (sessionId && !state.sessionId) {
    state.sessionId = sessionId;
  }

  if (emitOpenCodeSignalEvent(state, event, onEvent)) return;

  if (event.type === "text" && event.part?.text) {
    emitOpenCodeEvent(state, onEvent, {
      kind: "text",
      payload: { text: event.part.text, mentions: [] },
      source: { runtime_event_type: "text", runtime_message_id: null },
    });
    return;
  }

  if (event.type === "tool_use" && event.part?.tool_use) {
    emitOpenCodeToolEvents(state, event, onEvent);
    return;
  }

  if (event.type === "step_finish") {
    emitOpenCodeStepFinish(state, event, onEvent);
    return;
  }

  if (event.type === "error") {
    emitOpenCodeError(state, event, onEvent);
  }
}

function emitOpenCodeSignalEvent(state: OpenCodeParseState, event: OpenCodeEvent, onEvent: (event: AgentEvent) => void): boolean {
  if (event.type !== "turn_started" && event.type !== "turn_completed" && event.type !== "step_start") return false;
  emitOpenCodeEvent(state, onEvent, {
    kind: "signal",
    payload: { signal_type: event.type, data: null },
    source: { runtime_event_type: event.type, runtime_message_id: null },
  });
  return true;
}

function emitOpenCodeToolEvents(state: OpenCodeParseState, event: OpenCodeEvent, onEvent: (event: AgentEvent) => void): void {
  const tool = event.part!.tool_use!;
  emitOpenCodeEvent(state, onEvent, {
    kind: "tool_call",
    payload: { tool_name: tool.name, call_id: tool.id, input: tool.input, title: null },
    source: { runtime_event_type: "tool_use", runtime_message_id: null, runtime_call_id: tool.id },
  });
  if (event.part?.tool_result) {
    const result = event.part.tool_result;
    emitOpenCodeEvent(state, onEvent, {
      kind: "tool_result",
      payload: { call_id: result.call_id, output: result.output, is_error: result.is_error },
      source: { runtime_event_type: "tool_result", runtime_message_id: null, runtime_call_id: result.call_id },
    });
  }
}

function emitOpenCodeStepFinish(state: OpenCodeParseState, event: OpenCodeEvent, onEvent: (event: AgentEvent) => void): void {
  if (event.tokens) {
    const usage = usageDetailFromOpenCodeTokens(event.tokens, state.contextWindow);
    if (usage) emitOpenCodeEvent(state, onEvent, buildRuntimeUsageSignal(usage, "step_finish").event);
  }
  emitOpenCodeEvent(state, onEvent, {
    kind: "signal",
    payload: { signal_type: "step_finish", data: null },
    source: { runtime_event_type: "step_finish", runtime_message_id: null },
  });
}

function emitOpenCodeError(state: OpenCodeParseState, event: OpenCodeEvent, onEvent: (event: AgentEvent) => void): void {
  const errorMsg = typeof event.error === "string" ? event.error : event.error?.message ?? "Unknown error";
  state.errors.push(errorMsg);
  emitOpenCodeEvent(state, onEvent, {
    kind: "error",
    payload: { message: errorMsg },
    source: { runtime_event_type: "error", runtime_message_id: null },
  });
}

function formatOpenCodeDiagnostics(stderr: string, state: OpenCodeParseState): string {
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

function emitOpenCodeEvent(state: OpenCodeParseState, onEvent: (event: AgentEvent) => void, event: AgentEvent["event"]): void {
  if (event.kind !== "signal") state.outputEventCount += 1;
  onEvent({ type: "message_event", event });
}

function flushOpenCodeOutput(state: OpenCodeParseState, onEvent: (event: AgentEvent) => void): void {
  if (state.buffer.trim()) {
    try {
      const event: OpenCodeEvent = JSON.parse(state.buffer);
      processOpenCodeEvent(state, event, onEvent);
    } catch (error) {
      console.warn("[acs] failed to parse buffered OpenCode output:", error);
    }
  }
}

export const agent = new OpenCodeAgent();
