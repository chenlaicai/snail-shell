import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { getLogger } from "@infra/logger";
import type { AgentRuntimePort } from "@infra/acs/port";

const log = getLogger({ module: "acs" });
import type { FirstCallRequest, ResumeRequest, AgentEvent, InvokeResult, InvokeOptions, Message } from "@infra/acs/model";
import { buildResultTextEvent } from "@infra/acs/_internal/utils/event-utils";
import { manageInvocationProcess } from "@infra/acs/_internal/utils/managed-process";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "@infra/acs/_internal/utils/runtime-usage";
import { ensureMcpServers } from "@infra/acs/_internal/utils/mcp-config";
import { ensureSkillSymlinks } from "@infra/acs/_internal/utils/skill-symlinks";

/**
 * Claude Code stateless 适配器。
 *
 * 每次调用都重建完整上下文窗口。
 * 通过 --append-system-prompt-file 注入 system prompt，
 * 通过 stdin JSON 传递对话历史，
 * 通过 stdout stream-json 接收事件。
 */
export class ClaudeCodeAgent implements AgentRuntimePort {
  readonly name = "claude-code";

  constructor(
    private readonly spawnProcess: typeof spawn = spawn,
  ) {}

  async invokeFirstCall(
    request: FirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    setupCapabilities(request);

    log.info({ agentType: this.name, workspacePath: request.workspacePath, messageCount: request.messages.length }, "agent.invocation.started");

    // 构建 CLI args
    const args = [
      "-p",
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--permission-mode", "bypassPermissions",
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    // Guard deny → --disallowedTools
    if (request.guard_profile.deny.length > 0) {
      args.push("--disallowedTools", ...request.guard_profile.deny);
    }

    // MCP 配置
    args.push("--mcp-config", join(request.workspacePath, ".claude", "mcp.json"));

    // System prompt 文件注入
    let promptFilePath: string | null = null;
    if (request.prompt.systemPrompt) {
      promptFilePath = join(tmpdir(), `snail-system-prompt-${randomUUID()}.txt`);
      writeFileSync(promptFilePath, request.prompt.systemPrompt, "utf-8");
      args.push("--append-system-prompt-file", promptFilePath);
    }

    // Spawn process
    const proc = this.spawnProcess(
      "claude",
      args,
      { cwd: request.workspacePath, stdio: ["pipe", "pipe", "pipe"], detached: true, env: { ...process.env, ...options.contextEnv } }
    );

    // 管理进程生命周期
    const processController = manageInvocationProcess({
      proc,
      agentName: "ClaudeCode",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    // 读取 stdout 事件
    let outputEventCount = 0, resultContent = "", stderr = "";
    const stdoutDone = this.readOutput(proc, onEvent, () => { outputEventCount++; }, (content) => { resultContent = content; }, options.contextWindow);
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // 写入 stdin 消息
    this.writeMessages(proc, request.messages, request.prompt.systemReminder);

    // 等待完成
    try {
      await stdoutDone;
      proc.stdin?.end();
      await new Promise<void>(resolve => proc.on("close", () => {
        processController.cleanup();
        resolve();
      }));
      await processController.throwIfStopped();
    } finally {
      if (promptFilePath) cleanupFile(promptFilePath);
    }

    if (proc.exitCode !== 0 && !resultContent) {
      log.error({ agentType: this.name, exitCode: proc.exitCode, stderr: stderr.slice(0, 500) }, "agent.invocation.failed");
      throw new Error(`claude code exited with code ${proc.exitCode}: ${stderr}`);
    }

    if (outputEventCount === 0 && resultContent) {
      onEvent(buildResultTextEvent(resultContent, "result"));
      outputEventCount = 1;
    }

    if (outputEventCount === 0) {
      throw new Error(`claude code returned no output events${formatDiagnostics(stderr)}`);
    }

    log.info({ agentType: this.name, outputEventCount }, "agent.invocation.completed");
    return { waitForStop: () => processController.waitForStop() };
  }

  async invokeResume(
    _request: ResumeRequest,
    _onEvent: (event: AgentEvent) => void,
    _options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    throw new Error("claude-code is stateless and does not support invokeResume. Use invokeFirstCall instead.");
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private async readOutput(
    proc: ChildProcess,
    onEvent: (event: AgentEvent) => void,
    onOutputEvent: () => void,
    onResult: (content: string) => void,
    contextWindow?: number | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = "";

      proc.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = parseJsonLine(line, "ClaudeCode");
          if (event) handleClaudeCodeEvent(event, onEvent, onOutputEvent, onResult, contextWindow);
        }
      });

      proc.stdout?.on("error", (error) => {
        reject(new Error(`ClaudeCode stdout stream error: ${error.message}`));
      });

      proc.stdout?.on("end", () => {
        if (buffer.trim()) {
          const event = parseJsonLine(buffer, "ClaudeCode");
          if (event) handleClaudeCodeEvent(event, onEvent, onOutputEvent, onResult, contextWindow);
        }
        resolve();
      });
    });
  }

  private writeMessages(proc: ChildProcess, messages: Message[], systemReminder: string): void {
    const contentBlocks: Array<{ type: "text"; text: string }> = [];

    // system-reminder 注入到 user message 首位
    if (systemReminder) {
      contentBlocks.push({ type: "text", text: `<system-reminder>\n${systemReminder}\n</system-reminder>` });
    }

    // 消息内容：业务语义 → LLM 格式
    for (const msg of messages) {
      contentBlocks.push({ type: "text", text: `[${msg.speaker}]: ${msg.content}` });
    }

    this.writeStdin(proc, {
      type: "user",
      message: { role: "user", content: contentBlocks },
    });
  }

  private writeStdin(proc: ChildProcess, data: unknown): void {
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(JSON.stringify(data) + "\n");
    }
  }
}

function setupCapabilities(request: FirstCallRequest): void {
  ensureMcpServers(request.capabilities.mcpServers, request.workspacePath, "claude");
  ensureSkillSymlinks(request.workspacePath, request.capabilities.skills);
}

function cleanupFile(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (err) {
    log.warn({ err, filePath }, "failed to cleanup prompt file");
  }
}

function parseJsonLine(line: string, source: string): any | null {
  try {
    return JSON.parse(line);
  } catch (err) {
    log.warn({ err, source }, "failed to parse output line");
    return null;
  }
}

function handleClaudeCodeEvent(
  event: any,
  onEvent: (event: AgentEvent) => void,
  onOutputEvent: () => void,
  onResult: (content: string) => void,
  contextWindow?: number | null,
): void {
  if (event.type === "assistant") {
    emitClaudeAssistantEvents(event, onEvent, onOutputEvent);
    return;
  }
  if (event.type === "result") {
    emitClaudeResultEvents(event, onEvent, onResult, contextWindow);
  }
}

function emitClaudeAssistantEvents(event: any, onEvent: (event: AgentEvent) => void, onOutputEvent: () => void): void {
  const messageId = event.message?.id ?? null;
  for (const block of event.message?.content ?? []) {
    if (block.type === "text") {
      onOutputEvent();
      onEvent({ type: "message_event", event: { kind: "text", payload: { text: block.text, mentions: [] }, source: { runtime_event_type: "assistant", runtime_message_id: messageId, runtime_call_id: null } } });
    }
    if (block.type === "tool_use") {
      onOutputEvent();
      onEvent({ type: "message_event", event: { kind: "tool_call", payload: { tool_name: block.name, call_id: block.id, input: block.input ?? null, title: null }, source: { runtime_event_type: "assistant", runtime_message_id: messageId, runtime_call_id: block.id ?? null } } });
    }
  }
}

function emitClaudeResultEvents(event: any, onEvent: (event: AgentEvent) => void, onResult: (content: string) => void, contextWindow?: number | null): void {
  if (event.result) {
    const rawResult = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
    onResult(rawResult);
  }
  if (event.usage || event.modelUsage) {
    const usageDetail = usageDetailFromClaudeResult(event, contextWindow);
    if (usageDetail) onEvent(buildRuntimeUsageSignal(usageDetail, "result"));
  }
  if (event.is_error) {
    const rawResult = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
    onEvent({ type: "message_event", event: { kind: "message_failure", payload: { error: rawResult }, source: { runtime_event_type: "result", runtime_message_id: null } } });
  }
}

function formatDiagnostics(stderr: string): string {
  if (!stderr) return "";
  const maxLength = 500;
  const truncated = stderr.length > maxLength ? `${stderr.slice(0, maxLength)}...` : stderr;
  return ` (stderr: ${truncated})`;
}

export const agent = new ClaudeCodeAgent();
