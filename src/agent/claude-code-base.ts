import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Readable } from "stream";
import type {
  AgentEvent,
  AgentInvocationOptions,
  AgentInvocationResult,
  AgentRuntime,
  SnailRuntime,
  SnailRuntimeMessageInput,
} from "./interface";
import { manageInvocationProcess } from "./managed-process";
import { logger } from "../logger";
import { formatText } from "./log-preview";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "./runtime-usage";
import { buildDisallowedToolsArgs } from "./guard-config";
import type { GuardProfile } from "../shared/types";
import { prepareAgentInvocation } from "./capability-injector";

/** Claude Code stdout stream callbacks. */
export interface ClaudeCodeOutputCallbacks {
  onEvent: (event: AgentEvent) => void;
  onResult: (content: string) => void;
  onSessionId?: (sessionId: string) => void;
}

/**
 * Claude Code CLI 协议基类。
 *
 * 封装 Claude Code stdin/stdout JSON stream 协议的共享逻辑：
 * stdout 解析、事件映射、stderr 捕获、stdin 写入、进程生命周期管理。
 *
 * 子类只需实现 invokeMessage（构建 args + 发送用户消息）。
 */
export abstract class ClaudeCodeBase implements SnailRuntime {
  abstract readonly name: string;
  abstract readonly runtime: AgentRuntime;

  protected constructor(
    private readonly logPrefix: string,
    protected readonly spawnFn: typeof spawn = spawn,
  ) {}

  abstract invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions,
  ): Promise<AgentInvocationResult>;

  // ── Shared protocol methods ──────────────────────────────────────

  protected emitEvent(onEvent: (event: AgentEvent) => void, event: AgentEvent): void {
    logger.debug(`${this.logPrefix} mapped event`, { event });
    onEvent(event);
  }

  protected logStdoutLine(line: string): void {
    logger.debug(`${this.logPrefix} stdout raw line`, { line: formatText(line) });
  }

  protected parseStdoutMessage(line: string): any | null {
    try {
      return JSON.parse(line);
    } catch (error) {
      logger.warn(`${this.logPrefix} failed to parse stdout line`, { line: formatText(line), error });
      return null;
    }
  }

  protected logStdoutMessage(msg: any): void {
    logger.debug(`${this.logPrefix} stdout message`, {
      type: msg?.type,
      message: msg,
    });
  }

  protected handleAssistantMessage(msg: any, onEvent: (event: AgentEvent) => void): void {
    const messageId = msg.message?.id ?? null;
    for (const block of msg.message?.content ?? []) {
      if (block.type === "text") {
        this.emitTextBlock(block, messageId, onEvent);
      } else if (block.type === "tool_use") {
        this.emitToolUseBlock(block, messageId, onEvent);
      }
    }
  }

  protected emitTextBlock(block: any, messageId: string | null, onEvent: (event: AgentEvent) => void): void {
    this.emitEvent(onEvent, {
      type: "message_event",
      event: {
        kind: "text",
        payload: { text: block.text, mentions: [] },
        source: { runtime_event_type: "assistant", runtime_message_id: messageId },
      },
    });
  }

  protected emitToolUseBlock(block: any, messageId: string | null, onEvent: (event: AgentEvent) => void): void {
    this.emitEvent(onEvent, {
      type: "message_event",
      event: {
        kind: "tool_call",
        payload: { tool_name: block.name, call_id: block.id, input: block.input ?? null, title: null },
        source: {
          runtime_event_type: "assistant",
          runtime_message_id: messageId,
          runtime_call_id: block.id ?? null,
        },
      },
    });
  }

  protected handleResultMessage(
    msg: any,
    onEvent: (event: AgentEvent) => void,
    onResult: (content: string) => void,
    contextWindow?: number | null,
  ): void {
    const rawResult = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
    const permissionDenials: unknown[] = Array.isArray(msg.permission_denials) ? msg.permission_denials : [];

    logger.debug(`${this.logPrefix} result message`, {
      isError: msg.is_error,
      subtype: msg.subtype,
      durationMs: msg.duration_ms,
      durationApiMs: msg.duration_api_ms,
      result: formatText(rawResult),
      permissionDenialCount: permissionDenials.length,
    });

    if (msg.result) {
      logger.debug(`${this.logPrefix} final result content`, { result: formatText(rawResult) });
      onResult(rawResult);
    }

    const usage = usageDetailFromClaudeResult(msg, contextWindow);
    if (usage) this.emitEvent(onEvent, { type: "message_event", event: buildRuntimeUsageSignal(usage, "result") });

    if (permissionDenials.length > 0) {
      logger.debug(`${this.logPrefix} permission denials (ignored, settled by Claude Code)`, {
        tools: permissionDenials.map((d) => String((d as Record<string, unknown>)?.tool_name ?? "unknown")),
      });
    }

    if (msg.is_error) {
      this.emitEvent(onEvent, { type: "message_failure", error: rawResult });
    }
  }

  protected handleIgnoredMessage(msg: any): void {
    logger.debug(`${this.logPrefix} ignored stdout message`, {
      type: msg?.type,
      message: msg,
    });
  }

  protected writeStdin(proc: ChildProcess, data: unknown): void {
    if (proc.stdin && !proc.stdin.destroyed) {
      const written = proc.stdin.write(JSON.stringify(data) + "\n");
      if (!written) {
        proc.stdin.once("drain", () => {
          logger.debug(`${this.logPrefix} stdin drained after backpressure`);
        });
      }
    } else {
      logger.warn(`${this.logPrefix} cannot write to stdin`, { state: proc.stdin ? "destroyed" : "null" });
    }
  }

  protected captureStderr(proc: ChildProcess, tracker: { text: string }): void {
    proc.stderr?.on("data", (data: Buffer) => {
      tracker.text += data.toString();
      logger.debug(`${this.logPrefix} stderr`, { chunk: formatText(data.toString()) });
    });
  }

  /**
   * 子类可覆盖此方法以从 stdout 消息中提取 session ID。
   * 默认不提取（stateless agent 不维护 session）。
   */
  protected extractSessionId(_msg: any): string | null {
    return null;
  }

  /**
   * 读取 Claude Code stdout JSON stream，解析事件并分发。
   * stateful 和 stateless agent 共用此实现。
   */
  protected async readOutput(
    proc: ChildProcess,
    stdout: Readable,
    callbacks: ClaudeCodeOutputCallbacks,
    contextWindow?: number | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = "";

      stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.trim()) continue;
          this.logStdoutLine(line);
          const msg = this.parseStdoutMessage(line);
          if (!msg) continue;

          this.logStdoutMessage(msg);

          // Session ID extraction (stateful subclass overrides extractSessionId)
          const sessionId = this.extractSessionId(msg);
          if (sessionId && callbacks.onSessionId) {
            callbacks.onSessionId(sessionId);
          }

          switch (msg.type) {
            case "assistant": {
              this.handleAssistantMessage(msg, callbacks.onEvent);
              break;
            }
            case "result": {
              this.handleResultMessage(msg, callbacks.onEvent, callbacks.onResult, contextWindow);
              resolve();
              break;
            }
            default: {
              this.handleIgnoredMessage(msg);
              break;
            }
          }
        }
      });

      stdout.on("error", (error) => {
        logger.warn(`${this.logPrefix} stdout stream error`, { error: error.message });
        reject(new Error(`${this.logPrefix} stdout stream error: ${error.message}`));
      });

      stdout.on("end", () => resolve());
    });
  }

  // ── Shared process setup helpers ─────────────────────────────────

  /**
   * 构建 Claude Code CLI 共享参数（permission mode, model, guard, mcp-config）。
   * 子类在构建完整 args 时调用此方法获取基础参数。
   */
  protected buildBaseArgs(
    options: AgentInvocationOptions,
    guardProfile?: GuardProfile,
    workspaceRoot?: string,
  ): string[] {
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

    if (guardProfile) {
      args.push(...buildDisallowedToolsArgs(guardProfile));
    }

    args.push("--mcp-config", join(workspaceRoot ?? process.cwd(), ".claude", "mcp.json"));

    return args;
  }

  /**
   * 写入 systemPrompt 到临时文件，返回文件路径。
   * 调用方负责在进程关闭后清理此文件。
   */
  protected writeSystemPromptFile(systemPrompt: string): string {
    const filePath = join(tmpdir(), `snail-system-prompt-${randomUUID()}.txt`);
    writeFileSync(filePath, systemPrompt, "utf-8");
    return filePath;
  }

  /** 清理 systemPrompt 临时文件（非致命错误静默忽略）。 */
  protected cleanupPromptFile(filePath: string | null): void {
    if (filePath) {
      try { unlinkSync(filePath); } catch { /* cleanup failure is non-fatal */ }
    }
  }

  /**
   * 执行 capability 注入前导：ensureMcpServers + ensureSkillSymlinks + buildContextEnv。
   * 所有 Claude Code agent 在 invokeMessage 中调用此方法。
   */
  protected prepareInvocation(input: SnailRuntimeMessageInput): {
    contextEnv: Record<string, string>;
  } {
    return prepareAgentInvocation(input, "claude");
  }

  /**
   * Spawn Claude Code 进程并设置进程管理。
   */
  protected spawnClaudeCodeProcess(
    args: string[],
    options: AgentInvocationOptions,
    cwd?: string,
    contextEnv?: Record<string, string>,
  ): { proc: ChildProcess; processController: ReturnType<typeof manageInvocationProcess> } {
    const proc = this.spawnFn(
      "claude",
      args,
      { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true, env: { ...process.env, ...contextEnv } },
    );

    proc.on("error", (error) => {
      logger.error(`${this.logPrefix} spawn error`, { error });
    });

    const processController = manageInvocationProcess({
      proc,
      agentName: this.logPrefix,
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    return { proc, processController };
  }
}

export function isOutputEvent(event: AgentEvent): boolean {
  if (event.type !== "message_event") return false;
  return event.event.kind !== "signal" && event.event.kind !== "start";
}
