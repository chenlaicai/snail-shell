import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import type { AgentRuntimePort } from "../../port";
import type { AgentRequest, AgentEvent, InvokeResult, InvokeOptions, Message } from "../../model";
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
 * 有状态 agent：prompt 作为 CLI arg 传递，
 * 通过 --session 恢复已有会话。
 * Stdout 输出 JSON events。
 */
export class OpenCodeAgent implements AgentRuntimePort {
  readonly name = "opencode";
  private static readonly DEFAULT_MODEL = "my-geek/gpt-5.5";

  async invoke(
    request: AgentRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const { prompt, capabilities, security, messages, workspaceRoot, sessionId } = resolveRequest(request);

    // 注入 capabilities（首次调用）
    if (request.kind === "first_call") {
      writeOpenCodeGuardConfig(security.deny);
      ensureMcpServers(capabilities.mcpServers, workspaceRoot, "opencode");
      ensureSkillSymlinks(workspaceRoot, capabilities.skills);
    }

    const model = options.model ?? OpenCodeAgent.DEFAULT_MODEL;
    const statefulInput = buildStatefulPromptInput(request, prompt.systemPrompt, prompt.systemReminder, messages);
    const promptText = renderStatefulPrompt(statefulInput, { skipSystemPrompt: false });

    // 构建 CLI args
    const args = ["run", "--format", "json", "--model", model];
    if (sessionId) {
      args.push("--session", sessionId);
    }
    args.push(promptText);

    // 构建 env（移除 OPENCODE_* 避免泄漏父进程状态）
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const key of OPENCODE_ENV_KEYS) {
      delete env[key];
    }
    if (options.contextEnv) {
      Object.assign(env, options.contextEnv);
    }

    const proc = spawn("opencode", args, {
      cwd: workspaceRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

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
      sessionId: sessionId ?? null,
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
      throw new Error(`opencode exited with code ${exitCode}: ${stderr}`);
    }

    if (state.outputEventCount === 0) {
      throw new Error(`opencode returned no output events${stderr ? ` (stderr: ${stderr.slice(0, 500)})` : ""}`);
    }

    return { sessionId: state.sessionId, waitForStop: () => processController.waitForStop() };
  }
}

// ═══════════════════════════════════════════════════════════
// 内部辅助函数
// ═══════════════════════════════════════════════════════════

function resolveRequest(request: AgentRequest) {
  if (request.kind === "first_call") {
    return {
      prompt: request.prompt,
      capabilities: request.capabilities,
      security: request.security,
      messages: request.messages,
      workspaceRoot: request.workspaceRoot,
      sessionId: null as string | null,
    };
  }
  return {
    prompt: { systemPrompt: "", systemReminder: request.systemReminder, mcpContext: "" },
    capabilities: { skills: [] as any[], mcpServers: [] as any[] },
    security: { deny: [] as string[], allow: [] as string[] },
    messages: request.messages,
    workspaceRoot: request.workspaceRoot,
    sessionId: request.sessionId as string | null,
  };
}

function buildStatefulPromptInput(request: AgentRequest, systemPrompt: string, systemReminder: string, messages: Message[]): StatefulPromptInput {
  if (request.kind === "first_call") {
    const bootstrapMessages = dropLatestUserMessage(messages);
    return { systemPrompt, systemReminder, bootstrapMessages, incrementalMessages: [] };
  }
  return { systemReminder, incrementalMessages: messages };
}

function dropLatestUserMessage(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      return messages.filter((_, idx) => idx !== i);
    }
  }
  return [...messages];
}

function writeOpenCodeGuardConfig(deny: string[]): void {
  const configDir = path.join(os.homedir(), ".config", "opencode");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const configPath = path.join(configDir, "opencode.jsonc");

  const bashDenyPatterns: string[] = [];
  const toolDenies: Record<string, string> = {};

  for (const entry of deny) {
    const bashMatch = entry.match(/^Bash\((.+)\)$/);
    if (bashMatch) {
      const cmd = bashMatch[1];
      const opencodePattern = cmd.replace(/:\*$/, "*").replace(/:$/, "");
      bashDenyPatterns.push(opencodePattern);
      continue;
    }
    switch (entry) {
      case "AskUserQuestion":
        toolDenies["question"] = "deny";
        break;
      case "EnterPlanMode":
      case "ExitPlanMode":
        break;
      default:
        toolDenies[entry.toLowerCase()] = "deny";
    }
  }

  const permission: Record<string, unknown> = { "*": "allow" };
  if (bashDenyPatterns.length > 0) {
    const bashRules: Record<string, string> = { "*": "allow" };
    for (const pattern of bashDenyPatterns) {
      bashRules[pattern] = "deny";
    }
    permission["bash"] = bashRules;
  }
  Object.assign(permission, toolDenies);

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const cleaned = removeJsonComments(raw);
      existing = JSON.parse(cleaned);
    } catch {
      // 解析失败时从头生成
    }
  }

  const merged = { ...existing, $schema: "https://opencode.ai/config.json", permission };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n");
}

function removeJsonComments(jsonc: string): string {
  const tokens: string[] = [];
  let pos = 0;
  while (pos < jsonc.length) {
    const ch = jsonc[pos];
    if (ch === '"') {
      const chars = ['"'];
      let i = pos + 1;
      while (i < jsonc.length) {
        const c = jsonc[i];
        chars.push(c);
        if (c === "\\") { i++; if (i < jsonc.length) chars.push(jsonc[i]); }
        else if (c === '"') break;
        i++;
      }
      tokens.push(chars.join(""));
      pos = i + 1;
      continue;
    }
    if (ch === "/" && jsonc[pos + 1] === "/") {
      const lineEnd = jsonc.indexOf("\n", pos);
      pos = lineEnd === -1 ? jsonc.length : lineEnd;
      continue;
    }
    if (ch === "/" && jsonc[pos + 1] === "*") {
      const commentEnd = jsonc.indexOf("*/", pos + 2);
      pos = commentEnd === -1 ? jsonc.length : commentEnd + 2;
      continue;
    }
    tokens.push(ch);
    pos++;
  }
  return tokens.join("").replace(/,(\s*[}\]])/g, "$1");
}

function consumeOpenCodeOutput(state: OpenCodeParseState, chunk: string, onEvent: (event: AgentEvent) => void): void {
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";
  for (const line of lines) {
    handleOpenCodeLine(state, line, onEvent);
  }
}

function flushOpenCodeOutput(state: OpenCodeParseState, onEvent: (event: AgentEvent) => void): void {
  if (state.buffer.trim()) {
    handleOpenCodeLine(state, state.buffer, onEvent);
  }
  state.buffer = "";
}

function handleOpenCodeLine(state: OpenCodeParseState, line: string, onEvent: (event: AgentEvent) => void): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event: OpenCodeEvent;
  try {
    event = JSON.parse(trimmed) as OpenCodeEvent;
  } catch {
    return;
  }
  processOpenCodeEvent(event, state, onEvent);
}

function processOpenCodeEvent(event: OpenCodeEvent, state: OpenCodeParseState, onEvent: (event: AgentEvent) => void): void {
  // Extract session ID
  if (event.sessionID) {
    state.sessionId = event.sessionID;
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
    // OpenCode 在 tool_use 事件中同时包含 result
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

export const agent = new OpenCodeAgent();
