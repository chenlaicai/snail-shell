import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import type { AgentRuntimePort } from "../../port";
import type { FirstCallRequest, ResumeRequest, AgentEvent, InvokeResult, InvokeOptions, GuardProfile, Message } from "../../model";
import { manageInvocationProcess } from "../utils/managed-process";
import { renderStatefulPrompt, type StatefulPromptInput } from "../utils/stateful-prompt-format";
import { buildRuntimeUsageSignal, usageDetailFromOpenCodeTokens } from "../utils/runtime-usage";
import { ensureMcpServers } from "../utils/mcp-config";
import { ensureSkillSymlinks } from "../utils/skill-symlinks";

const OPENCODE_ENV_KEYS = [
  "OPENCODE", "OPENCODE_CLIENT", "OPENCODE_EXPERIMENTAL_FILEWATCHER",
  "OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", "OPENCODE_PID", "OPENCODE_PROCESS_ROLE",
  "OPENCODE_RUN_ID", "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME",
] as const;

interface OpenCodeEvent {
  type: string;
  sessionID?: string;
  part?: { type: string; text?: string; tool_use?: { name: string; id: string; input: unknown }; tool_result?: { call_id: string; output: string; is_error: boolean } };
  tokens?: unknown;
  error?: { message?: string; code?: string } | string;
  [key: string]: unknown;
}

interface OpenCodeParseState {
  buffer: string;
  outputEventCount: number;
  sessionId: string | null;
  contextWindow: number | null;
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
    writeOpenCodeGuardConfig(request.guard_profile.deny);
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
      stdio: ["pipe", "pipe", "pipe"],
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
    const state: OpenCodeParseState = {
      buffer: "",
      outputEventCount: 0,
      sessionId: existingSessionId,
      contextWindow: options.contextWindow ?? null,
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      consumeOpenCodeOutput(state, chunk.toString(), onEvent);
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

    if (state.outputEventCount === 0) {
      throw new Error("opencode returned no output events");
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

function writeOpenCodeGuardConfig(deny: string[]): void {
  // 写入 ~/.config/opencode/opencode.jsonc 的 permission 配置
}

function consumeOpenCodeOutput(state: OpenCodeParseState, chunk: string, onEvent: (event: AgentEvent) => void): void {
  state.buffer += chunk;

  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event: OpenCodeEvent = JSON.parse(line);
      processOpenCodeEvent(state, event, onEvent);
    } catch {}
  }
}

function processOpenCodeEvent(state: OpenCodeParseState, event: OpenCodeEvent, onEvent: (event: AgentEvent) => void): void {
  if (event.sessionID && !state.sessionId) {
    state.sessionId = event.sessionID;
  }

  if (event.type === "turn_started") {
    emitOpenCodeEvent(state, onEvent, {
      kind: "signal",
      payload: { signal_type: "turn_started", data: null },
      source: { runtime_event_type: "turn_started", runtime_message_id: null },
    });
    return;
  }

  if (event.type === "turn_completed") {
    emitOpenCodeEvent(state, onEvent, {
      kind: "signal",
      payload: { signal_type: "turn_completed", data: null },
      source: { runtime_event_type: "turn_completed", runtime_message_id: null },
    });
    return;
  }

  if (event.type === "step_start") {
    emitOpenCodeEvent(state, onEvent, {
      kind: "signal",
      payload: { signal_type: "step_start", data: null },
      source: { runtime_event_type: "step_start", runtime_message_id: null },
    });
    return;
  }

  if (event.type === "text" && event.part?.text) {
    emitOpenCodeEvent(state, onEvent, {
      kind: "text",
      payload: { text: event.part.text, mentions: [] },
      source: { runtime_event_type: "text", runtime_message_id: null },
    });
    return;
  }

  if (event.type === "tool_use" && event.part?.tool_use) {
    const tool = event.part.tool_use;
    emitOpenCodeEvent(state, onEvent, {
      kind: "tool_call",
      payload: { tool_name: tool.name, call_id: tool.id, input: tool.input, title: null },
      source: { runtime_event_type: "tool_use", runtime_message_id: null, runtime_call_id: tool.id },
    });
    if (event.part.tool_result) {
      const result = event.part.tool_result;
      emitOpenCodeEvent(state, onEvent, {
        kind: "tool_result",
        payload: { call_id: result.call_id, output: result.output, is_error: result.is_error },
        source: { runtime_event_type: "tool_result", runtime_message_id: null, runtime_call_id: result.call_id },
      });
    }
    return;
  }

  if (event.type === "step_finish") {
    if (event.tokens) {
      const usage = usageDetailFromOpenCodeTokens(event.tokens, state.contextWindow);
      if (usage) emitOpenCodeEvent(state, onEvent, buildRuntimeUsageSignal(usage, "step_finish").event);
    }
    emitOpenCodeEvent(state, onEvent, {
      kind: "signal",
      payload: { signal_type: "step_finish", data: null },
      source: { runtime_event_type: "step_finish", runtime_message_id: null },
    });
    return;
  }

  if (event.type === "error") {
    const errorMsg = typeof event.error === "string" ? event.error : event.error?.message ?? "Unknown error";
    emitOpenCodeEvent(state, onEvent, {
      kind: "error",
      payload: { message: errorMsg },
      source: { runtime_event_type: "error", runtime_message_id: null },
    });
  }
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
    } catch {}
  }
}

export const agent = new OpenCodeAgent();
