import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Readable } from "stream";
import type {
  AgentInvocationResult,
  AgentEvent,
  AgentInvocationOptions,
  SnailRuntime,
  SnailRuntimeMessageInput,
  StatelessAgentInvoker,
  StatelessInvocationInput,
  ToolPermissionRequest,
} from "./interface";
import { manageInvocationProcess } from "./managed-process";
import { logger } from "../logger";
import { buildStatelessMessages } from "./prompt-mapper";
import { formatText } from "./log-preview";
import { renderStatelessTranscript } from "./stateless-runtime-adapter";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "./runtime-usage";
import { writeGuardSettings, buildDenyList } from "./guard-config";
import { ensureMcpServers } from "./mcp-config";
import type { GuardProfile } from "./capability";

interface TrackedToolCall {
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export class ClaudeCodeAgent implements SnailRuntime, StatelessAgentInvoker {
  readonly name = "claude-code";
  readonly runtime = "claude-code-cli";

  /** 当前 invocation 的 GuardProfile，供 handleResultMessage 区分 hard/soft denial。 */
  private currentGuardProfile: GuardProfile | null = null;
  /** 当前 invocation 已发射的 tool_call，按 call_id 索引，供 denial 分类时还原命令。 */
  private emittedToolCalls = new Map<string, TrackedToolCall>();

  constructor(
    private readonly spawnProcess: typeof spawn = spawn,
  ) {}

  private emitEvent(onEvent: (event: AgentEvent) => void, event: AgentEvent): void {
    logger.debug("ClaudeCode mapped event", { event });
    onEvent(event);
  }

  private logStdoutLine(line: string): void {
    logger.debug("ClaudeCode stdout raw line", { line: formatText(line) });
  }

  private parseStdoutMessage(line: string): any | null {
    try {
      return JSON.parse(line);
    } catch (error) {
      logger.warn("ClaudeCode failed to parse stdout line", { line: formatText(line), error });
      return null;
    }
  }

  private logStdoutMessage(msg: any): void {
    logger.debug("ClaudeCode stdout message", {
      type: msg?.type,
      message: msg,
    });
  }

  private handleAssistantMessage(msg: any, onEvent: (event: AgentEvent) => void): void {
    for (const block of msg.message?.content ?? []) {
      if (block.type === "text") {
        this.emitEvent(onEvent, { type: "message_event", event: { kind: "text", payload: { text: block.text, mentions: [] }, source: { runtime_event_type: "assistant", runtime_message_id: msg.message?.id ?? null } } });
      } else if (block.type === "tool_use") {
        const toolCall: TrackedToolCall = {
          tool_use_id: block.id,
          tool_name: block.name,
          tool_input: block.input ?? {},
        };
        this.emittedToolCalls.set(block.id, toolCall);

        this.emitEvent(onEvent, {
          type: "message_event",
          event: {
            kind: "tool_call",
            payload: { tool_name: block.name, call_id: block.id, input: block.input ?? null, title: null },
            source: { runtime_event_type: "assistant", runtime_message_id: msg.message?.id ?? null, runtime_call_id: block.id ?? null },
          },
        });
      }
    }
  }

  private handleResultMessage(msg: any, onEvent: (event: AgentEvent) => void, onResult: (content: string) => void, contextWindow?: number | null): void {
    const rawResult = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
    const permissionDenials: unknown[] = Array.isArray(msg.permission_denials) ? msg.permission_denials : [];
    logger.debug("ClaudeCode result message", {
      isError: msg.is_error,
      subtype: msg.subtype,
      durationMs: msg.duration_ms,
      durationApiMs: msg.duration_api_ms,
      result: formatText(rawResult),
      permissionDenialCount: permissionDenials.length,
    });
    if (msg.result) {
      logger.debug("ClaudeCode final result content", {
        result: formatText(rawResult),
      });
      /** Claude exposes a native terminal result envelope. */
      onResult(rawResult);
    }
    const usage = usageDetailFromClaudeResult(msg, contextWindow);
    if (usage) this.emitEvent(onEvent, { type: "message_event", event: buildRuntimeUsageSignal(usage, "result") });

    if (permissionDenials.length > 0) {
      const { hardDenials, softDenials } = this.classifyDenials(permissionDenials);

      // 硬拒绝（黑名单 matches）：保持现有行为——报错 + message_failure
      if (hardDenials.length > 0) {
        const hardMsg = this.formatDenialMessage(hardDenials);
        this.emitEvent(onEvent, { type: "message_event", event: { kind: "error", payload: { source: "runtime", message: hardMsg, detail: null }, source: { runtime_event_type: "result" } } });
        this.emitEvent(onEvent, { type: "message_failure", error: hardMsg });
      }

      // 软拒绝（不在黑白名单中）：发射 permission_required 等待用户审批
      for (const denial of softDenials) {
        const request = this.buildPermissionRequest(denial);
        if (request) {
          this.emitEvent(onEvent, {
            type: "permission_required",
            request,
          });
          // 发射 signal 事件记录到消息事件流中（UI 可据此展示被拒工具信息）
          this.emitEvent(onEvent, {
            type: "message_event",
            event: {
              kind: "signal",
              payload: {
                type: "permission_blocked",
                reason: `Tool "${request.tool_name}" requires approval`,
                detail: { request },
              },
              source: { runtime_event_type: "result" },
            },
          });
        }
      }

      // 仅硬拒绝时 emit message_failure（已在上面 emit 过）
      // 仅软拒绝时 emit permission_required（不会 emit message_failure）
      return;
    }

    if (msg.is_error) {
      this.emitEvent(onEvent, { type: "message_failure", error: rawResult });
    }
  }

  /**
   * 将被拒工具分为硬拒绝（匹配 denyPatterns）和软拒绝（不在黑白名单中，需审批）。
   * 通过跟 GuardProfile denyPatterns + buildDenyList 匹配结果区分。
   */
  private classifyDenials(denials: unknown[]): { hardDenials: unknown[]; softDenials: unknown[] } {
    const guard = this.currentGuardProfile;
    const hardDenials: unknown[] = [];
    const softDenials: unknown[] = [];

    for (const denial of denials) {
      const item = denial as Record<string, unknown>;
      const toolName = String(item?.tool_name ?? "");
      const toolUseId = String(item?.tool_use_id ?? item?.id ?? "");

      // 尝试从已发射的 tool_call 中还原被拒工具的完整 input
      const trackedTool = toolUseId ? this.emittedToolCalls.get(toolUseId) : undefined;
      const command: string | undefined = (item?.tool_input as Record<string, unknown>)?.command as string
        ?? trackedTool?.tool_input?.command as string;

      const isHardDeny = guard ? isCommandInDenyPatterns(command, toolName, guard) : false;

      if (isHardDeny) {
        hardDenials.push(denial);
      } else {
        softDenials.push(denial);
      }
    }

    return { hardDenials, softDenials };
  }

  /**
   * 从 denial 对象构造 ToolPermissionRequest。
   * 优先使用 denial 自身的 tool_use_id 和 tool_input；回退到已跟踪的 tool_call。
   */
  private buildPermissionRequest(denial: unknown): ToolPermissionRequest | null {
    const item = denial as Record<string, unknown>;
    const toolName = String(item?.tool_name ?? "unknown");
    const toolUseId = String(item?.tool_use_id ?? item?.id ?? "");
    const toolInput = (item?.tool_input as Record<string, unknown>)
      ?? (toolUseId ? this.emittedToolCalls.get(toolUseId)?.tool_input : undefined)
      ?? {};

    if (!toolName || toolName === "unknown") return null;

    return {
      tool_use_id: toolUseId || `denied-${Date.now()}`,
      tool_name: toolName,
      tool_input: toolInput,
    };
  }

  private formatDenialMessage(denials: unknown[]): string {
    const tools = denials
      .map((item) => typeof item === "object" && item !== null && "tool_name" in item ? String((item as { tool_name?: unknown }).tool_name ?? "unknown") : "unknown")
      .join(", ");
    return `Claude Code denied required tool approval (${tools}). The agent did not continue execution.`;
  }

  private handleIgnoredMessage(msg: any): void {
    logger.debug("ClaudeCode ignored stdout message", {
      type: msg?.type,
      message: msg,
    });
  }

  async invokeMessage(input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions): Promise<AgentInvocationResult> {
    // Claude Code stays on the stateless path. Snail Shell reconstructs the per-message
    // working context and Claude answers from that supplied window only.
    const systemPrompt = input.capability.systemPrompt;
    const systemReminder = input.capability.systemReminder;

    // 在 spawn agent 进程前，将 ACS GuardProfile 翻译为 Claude Code 原生权限配置
    writeGuardSettings(input.capability.guardProfile, input.projectRoot);

    // 保存 GuardProfile 供 handleResultMessage 中 classifyDenials 使用
    this.currentGuardProfile = input.capability.guardProfile;
    this.emittedToolCalls.clear();

    // 消费 ACP mcpServers：确保 CWD 的 .mcp.json 包含 MCP server 配置（标准 auto-discovery）
    ensureMcpServers(input.capability.mcpServers);

    return this.invokeStateless(
      {
        systemPrompt,
        systemReminder,
        messages: buildStatelessMessages(input),
      },
      onEvent,
      options,
      input.projectRoot,
    );
  }

  async invokeStateless(
    input: StatelessInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options: AgentInvocationOptions = {},
    cwd?: string,
  ): Promise<AgentInvocationResult> {
    const { systemPrompt, systemReminder } = input;
    // Claude Code CLI is integrated in strict single-message mode.
    // - `--no-session-persistence`: Snail Shell, not Claude, owns conversation state.
    // - `--output-format/--input-format stream-json`: required so we can map Claude's
    //   streaming protocol into Snail Shell's AgentEvent model.
    // - `--permission-mode acceptEdits`: 使用 Claude Code 原生权限系统。
    //   safe 操作（文件读写、搜索）自动放行；dangerous 操作（shell 命令、网络请求）
    //   由 settings.json 的 allow/deny 列表 + 分类器判定。Snail Shell 通过 ACS
    //   GuardProfile 翻译为 settings.json 来控制安全策略，不再自己拦截工具调用。
    const args = [
      "-p",
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--permission-mode", "acceptEdits",
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    // systemPrompt（静态规则）通过 --append-system-prompt-file 追加到 Claude 内置 system prompt
    // 内容稳定 → 可被 Anthropic API 缓存。systemReminder（动态上下文）通过用户消息注入。
    let promptFilePath: string | null = null;
    if (systemPrompt) {
      promptFilePath = join(tmpdir(), `snail-system-prompt-${randomUUID()}.txt`);
      writeFileSync(promptFilePath, systemPrompt, "utf-8");
      args.push("--append-system-prompt-file", promptFilePath);
    }

    const proc = this.spawnProcess(
      "claude",
      args,
      { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true }
    );

    const processController = manageInvocationProcess({ proc, agentName: "ClaudeCode", signal: options.signal, invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000 });

    let resultContent = "";
    let outputEventCount = 0;
    const stderrTracker = { text: "" };

    const closeDone = new Promise<void>((resolve) => {
      proc.on("close", (code, signal) => {
        processController.cleanup();
        if (promptFilePath) { try { unlinkSync(promptFilePath); } catch { /* cleanup failure is non-fatal */ } }
        logger.debug("ClaudeCode process closed", { code, signal, stderrPreview: formatText(stderrTracker.text) });
        resolve();
      });
    });

    // Read stderr for debugging
    this.captureStderr(proc, stderrTracker);

    // Start reading stdout
    const outputDone = this.readOutput(proc, proc.stdout!, (event) => {
      if (isOutputEvent(event)) outputEventCount += 1;
      onEvent(event);
    }, (content) => {
      resultContent = content;
    }, options.contextWindow);

    // Send user message. systemPrompt 已通过 --append-system-prompt-file 注入；
    // systemReminder 在变化时作为前缀内容块注入。
    const userContent = this.renderUserContent(input.messages);
    const contentBlocks: Array<{ type: "text"; text: string }> = [];
    if (systemReminder) {
      contentBlocks.push({ type: "text", text: `<system-reminder>\n${systemReminder}\n</system-reminder>` });
    }
    contentBlocks.push({ type: "text", text: userContent });

    logger.debug("ClaudeCode stateless invocation", {
      args: args.filter((a) => a !== promptFilePath), // 不打印 temp 路径
      systemPromptSize: systemPrompt?.length ?? 0,
      systemReminderSize: systemReminder?.length ?? 0,
      transcriptSize: userContent.length,
    });

    this.writeStdin(proc, {
      type: "user",
      message: { role: "user", content: contentBlocks },
    });

    // Wait for output to finish
    await outputDone;

    // Close stdin to signal end of input
    proc.stdin?.end();

    await closeDone;

    await processController.throwIfStopped();

    if (proc.exitCode !== 0 && !resultContent) {
      throw new Error(`claude code exited with code ${proc.exitCode}: ${stderrTracker.text}`);
    }

    if (outputEventCount === 0) {
      const maxLen = 500;
      const stderrText = stderrTracker.text;
      const truncated = stderrText.length > maxLen ? stderrText.slice(0, maxLen) + "..." : stderrText;
      const diagnosticInfo = stderrText ? ` (stderr: ${truncated})` : "";
      throw new Error(`claude code returned no output events${diagnosticInfo}`);
    }
    return {};
  }

  private async readOutput(
    proc: ChildProcess,
    stdout: Readable,
    onEvent: (event: AgentEvent) => void,
    onResult: (content: string) => void,
    contextWindow?: number | null
  ): Promise<void> {
    return new Promise((resolve) => {
      let buffer = "";

      stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.trim()) continue;
          this.logStdoutLine(line);
          const msg = this.parseStdoutMessage(line);
          if (!msg) {
            continue;
          }

          this.logStdoutMessage(msg);

          switch (msg.type) {
            case "assistant": {
              this.handleAssistantMessage(msg, onEvent);
              break;
            }
            case "result": {
              this.handleResultMessage(msg, onEvent, onResult, contextWindow);
              // Resolve immediately when we get the result
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

      stdout.on("end", () => resolve());
    });
  }

  private captureStderr(proc: ChildProcess, tracker: { text: string }): void {
    proc.stderr?.on("data", (data: Buffer) => {
      tracker.text += data.toString();
      logger.debug("ClaudeCode stderr", { chunk: formatText(data.toString()) });
    });
  }

  private writeStdin(proc: ChildProcess, data: unknown): void {
    if (proc.stdin && !proc.stdin.destroyed) {
      const written = proc.stdin.write(JSON.stringify(data) + "\n");
      if (!written) {
        proc.stdin.once('drain', () => {
          logger.debug("ClaudeCode stdin drained after backpressure");
        });
      }
    } else {
      logger.warn("ClaudeCode cannot write to stdin", { state: proc.stdin ? "destroyed" : "null" });
    }
  }

  private renderUserContent(messages: StatelessInvocationInput["messages"]): string {
    return renderStatelessTranscript(messages);
  }
}

function isOutputEvent(event: AgentEvent): boolean {
  if (event.type !== "message_event") return false;
  return event.event.kind !== "signal" && event.event.kind !== "start";
}

/**
 * 检查命令是否匹配 GuardProfile denyPatterns（硬拒绝）。
 * denyPatterns 通过 buildDenyList 翻译为 `Bash(pattern:*)` 格式，此函数检查
 * 被拒工具的 tool_name + command 是否命中任一 deny pattern。
 */
function isCommandInDenyPatterns(command: string | undefined, toolName: string, guard: GuardProfile): boolean {
  if (!command) {
    // 无命令文本时，仅检查 tool_name 级 deny（如数据库 CLI 全量 deny）
    const denyList = buildDenyList(guard).map((p) => p.toLowerCase());
    return denyList.some((pattern) => {
      const m = /^bash\((.*):\*\)$/i.exec(pattern);
      if (!m) return false;
      const prefix = m[1].toLowerCase();
      return toolName.toLowerCase() === prefix || toolName.toLowerCase().startsWith(prefix);
    });
  }

  const denyList = buildDenyList(guard).map((p) => p.toLowerCase());
  const normalized = command.toLowerCase().trim();

  return denyList.some((pattern) => {
    const m = /^bash\((.*):\*\)$/i.exec(pattern);
    if (!m) {
      return toolName.toLowerCase() === pattern.toLowerCase();
    }
    const prefix = m[1].toLowerCase();
    // 直接前缀匹配（如 `sqlite3`, `chmod 777`）
    if (normalized.startsWith(prefix)) return true;
    // git/pip/npm 等子命令形式（如 deny pattern `push --force main` 匹配 `git push --force main`）
    for (const toolPrefix of ["git ", "npm ", "npx ", "pip ", "pip3 "]) {
      if (normalized.startsWith(toolPrefix + prefix)) return true;
    }
    return false;
  });
}
