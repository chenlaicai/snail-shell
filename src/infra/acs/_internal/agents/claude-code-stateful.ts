import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { getLogger } from "@infra/logger";
import type { AgentRuntimePort } from "@infra/acs/port";

const log = getLogger({ module: "acs" });
import type { FirstCallRequest, ResumeRequest, AgentEvent, InvokeResult, InvokeOptions, GuardProfile, Message } from "@infra/acs/model";
import { buildResultTextEvent } from "@infra/acs/_internal/utils/event-utils";
import { manageInvocationProcess } from "@infra/acs/_internal/utils/managed-process";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "@infra/acs/_internal/utils/runtime-usage";
import { ensureMcpServers } from "@infra/acs/_internal/utils/mcp-config";
import { ensureSkillSymlinks } from "@infra/acs/_internal/utils/skill-symlinks";

/**
 * Claude Code stateful 适配器。
 *
 * 有状态 agent：首次调用注入完整配置，后续调用通过 --resume sessionId 恢复会话。
 */
export class ClaudeCodeStatefulAgent implements AgentRuntimePort {
  readonly name = "claude-code-stateful";

  constructor(
    private readonly spawnFn: typeof spawn = spawn,
  ) {}

  /**
   * 首次调用：注入完整配置（capabilities + guard profile + prompt）。
   */
  async invokeFirstCall(
    request: FirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    log.info({ agentType: this.name, workspacePath: request.workspacePath, messageCount: request.messages.length }, "agent.invocation.started");

    // 注入 capabilities（文件系统级别）
    ensureMcpServers(request.capabilities.mcpServers, request.workspacePath, "claude");
    ensureSkillSymlinks(request.workspacePath, request.capabilities.skills);

    // 构建首次调用的 CLI args
    const args = this.buildBaseArgs(options);
    this.addGuardArgs(args, request.guard_profile);
    this.addMcpConfigArg(args, request.workspacePath);
    const promptFilePath = this.addPromptFileArg(args, request.prompt);

    // Spawn 进程
    const proc = this.spawn(args, request.workspacePath, options);

    // 发送消息（含 system-reminder）
    this.writeMessages(proc, request.messages, request.prompt.systemReminder);

    try {
      return await this.processOutput(proc, onEvent, options, null);
    } finally {
      if (promptFilePath) {
        cleanupFile(promptFilePath);
      }
    }
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
    const args = this.buildBaseArgs(options);
    this.addMcpConfigArg(args, request.workspacePath);
    args.push("--resume", request.sessionId);

    // Spawn 进程
    const proc = this.spawn(args, request.workspacePath, options);

    // 发送消息（含 system-reminder）
    this.writeMessages(proc, request.messages, request.systemReminder);

    // 处理输出
    return this.processOutput(proc, onEvent, options, request.sessionId);
  }

  // ── 通用辅助方法 ──────────────────────────────────────────────────────

  /** 构建基础 CLI args（不含 guard profile、mcp-config、prompt） */
  private buildBaseArgs(options: InvokeOptions): string[] {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--permission-mode", "bypassPermissions",
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    return args;
  }

  /** 添加 guard profile 相关 args（仅首次调用） */
  private addGuardArgs(args: string[], guardProfile: GuardProfile): void {
    if (guardProfile.deny.length > 0) {
      args.push("--disallowedTools", ...guardProfile.deny);
    }
  }

  /** 添加 mcp-config arg（每次调用） */
  private addMcpConfigArg(args: string[], workspacePath: string): void {
    args.push("--mcp-config", join(workspacePath, ".claude", "mcp.json"));
  }

  /** 添加 prompt 文件 arg（仅首次调用），返回临时文件路径供调用方清理 */
  private addPromptFileArg(args: string[], prompt: FirstCallRequest["prompt"]): string | null {
    if (!prompt.systemPrompt) return null;
    const filePath = join(tmpdir(), `snail-system-prompt-${randomUUID()}.txt`);
    writeFileSync(filePath, prompt.systemPrompt, "utf-8");
    args.push("--append-system-prompt-file", filePath);
    return filePath;
  }

  /** Spawn Claude Code 进程 */
  private spawn(args: string[], workspacePath: string, options: InvokeOptions): ChildProcess {
    return this.spawnFn(
      "claude",
      args,
      {
        cwd: workspacePath,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
        env: { ...process.env, ...options.contextEnv },
      }
    );
  }

  /** 通过 stdin 发送消息 */
  private writeMessages(proc: ChildProcess, messages: Message[], systemReminder?: string): void {
    const contentBlocks: Array<{ type: string; text: string }> = [];

    if (systemReminder) {
      contentBlocks.push({
        type: "text",
        text: `<system-reminder>\n${systemReminder}\n</system-reminder>`,
      });
    }

    contentBlocks.push(...messages.map(msg => ({
      type: "text",
      text: `[${msg.speaker}]: ${msg.content}`,
    })));

    proc.stdin?.write(JSON.stringify({
      type: "user",
      message: { role: "user", content: contentBlocks },
    }) + "\n");
    proc.stdin?.end();
  }

  /** 处理进程输出，返回 InvokeResult */
  private async processOutput(
    proc: ChildProcess,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions,
    existingSessionId: string | null,
  ): Promise<InvokeResult> {
    const processController = manageInvocationProcess({
      proc,
      agentName: "ClaudeCodeStateful",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    let extractedSessionId: string | null = existingSessionId;
    let outputEventCount = 0;
    let resultContent = "";
    let stderr = "";
    let stdoutError: Error | null = null;
    const closeDone = new Promise<void>((resolve) => {
      proc.on("close", () => {
        processController.cleanup();
        resolve();
      });
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.stdout?.on("error", (error) => {
      stdoutError = error;
      stderr += `ClaudeCodeStateful stdout stream error: ${error.message}`;
    });

    // stdout: 解析事件
    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = parseJsonLine(line, "ClaudeCodeStateful");
        if (event) {
          extractedSessionId = handleClaudeCodeStatefulEvent(event, (agentEvent) => {
            if (isOutputEvent(agentEvent)) outputEventCount += 1;
            onEvent(agentEvent);
          }, (content) => { resultContent = content; }, extractedSessionId, options.contextWindow);
        }
      }
    });

    await closeDone;
    if (buffer.trim()) {
      const event = parseJsonLine(buffer, "ClaudeCodeStateful");
      if (event) {
        extractedSessionId = handleClaudeCodeStatefulEvent(event, (agentEvent) => {
          if (isOutputEvent(agentEvent)) outputEventCount += 1;
          onEvent(agentEvent);
        }, (content) => { resultContent = content; }, extractedSessionId, options.contextWindow);
      }
    }
    await processController.throwIfStopped();
    if (stdoutError) throw stdoutError;

    if (proc.exitCode !== 0 && !resultContent) {
      log.error({ agentType: this.name, exitCode: proc.exitCode, stderr: stderr.slice(0, 500) }, "agent.invocation.failed");
      throw new Error(`claude code stateful exited with code ${proc.exitCode}: ${stderr}`);
    }

    if (outputEventCount === 0 && resultContent) {
      onEvent(buildResultTextEvent(resultContent, "result"));
      outputEventCount = 1;
    }

    if (outputEventCount === 0) {
      throw new Error(`claude code stateful returned no output events${formatDiagnostics(stderr)}`);
    }

    log.info({ agentType: this.name, outputEventCount }, "agent.invocation.completed");
    return {
      sessionId: extractedSessionId,
      waitForStop: () => processController.waitForStop(),
    };
  }
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

function handleClaudeCodeStatefulEvent(event: any, onEvent: (event: AgentEvent) => void, onResult: (content: string) => void, currentSessionId: string | null, contextWindow?: number | null): string | null {
  if (event.type === "assistant") {
    emitClaudeAssistantEvents(event, onEvent);
    return currentSessionId;
  }
  if (event.type !== "result") return currentSessionId;
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
  return event.session_id ?? currentSessionId;
}

function emitClaudeAssistantEvents(event: any, onEvent: (event: AgentEvent) => void): void {
  const messageId = event.message?.id ?? null;
  for (const block of event.message?.content ?? []) {
    if (block.type === "text") {
      onEvent({ type: "message_event", event: { kind: "text", payload: { text: block.text, mentions: [] }, source: { runtime_event_type: "assistant", runtime_message_id: messageId, runtime_call_id: null } } });
    }
    if (block.type === "tool_use") {
      onEvent({ type: "message_event", event: { kind: "tool_call", payload: { tool_name: block.name, call_id: block.id, input: block.input ?? null, title: null }, source: { runtime_event_type: "assistant", runtime_message_id: messageId, runtime_call_id: block.id ?? null } } });
    }
  }
}

function formatDiagnostics(stderr: string): string {
  if (!stderr) return "";
  const maxLength = 500;
  const truncated = stderr.length > maxLength ? `${stderr.slice(0, maxLength)}...` : stderr;
  return ` (stderr: ${truncated})`;
}

function isOutputEvent(event: AgentEvent): boolean {
  return event.type === "message_event" && (event.event.kind === "text" || event.event.kind === "tool_call" || event.event.kind === "tool_result");
}

export const agent = new ClaudeCodeStatefulAgent();
