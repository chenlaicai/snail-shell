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
} from "./interface";
import { manageInvocationProcess } from "./managed-process";
import { logger } from "../logger";
import { buildStatelessMessages } from "./prompt-mapper";
import { formatText } from "./log-preview";
import { renderStatelessTranscript } from "./stateless-runtime-adapter";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "./runtime-usage";
import { writeGuardSettings } from "./guard-config";
import { permissionStore } from "./permission-store";
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

  /** 当前 invocation 的 GuardProfile，供 handleResultMessage 匹配 deny 列表。 */
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
      const guard = this.currentGuardProfile;
      const hasSecurityViolation = guard && permissionDenials.some((denial) => {
        const item = denial as Record<string, unknown>;
        const toolName = String(item?.tool_name ?? "");
        const toolUseId = String(item?.tool_use_id ?? item?.id ?? "");
        const trackedTool = toolUseId ? this.emittedToolCalls.get(toolUseId) : undefined;
        const command: string | undefined = (item?.tool_input as Record<string, unknown>)?.command as string
          ?? trackedTool?.tool_input?.command as string;
        return isCommandInDenyPatterns(command, toolName, guard);
      });

      if (hasSecurityViolation) {
        const deniedTools = permissionDenials
          .map((d) => String((d as Record<string, unknown>)?.tool_name ?? "unknown"))
          .join(", ");
        const msg = `Claude Code denied required tool approval (${deniedTools}). The agent did not continue execution.`;
        this.emitEvent(onEvent, { type: "message_event", event: { kind: "error", payload: { source: "runtime", message: msg, detail: null }, source: { runtime_event_type: "result" } } });
        this.emitEvent(onEvent, { type: "message_failure", error: msg });
        return;
      }

      // 不匹配 deny 列表的拒绝（如非交互模式下的工具限制）→ 忽略，不触发审批 UI
      logger.debug("ClaudeCode denials ignored (not in deny list)", {
        tools: permissionDenials.map((d) => String((d as Record<string, unknown>)?.tool_name ?? "unknown")),
      });
      return;
    }

    if (msg.is_error) {
      this.emitEvent(onEvent, { type: "message_failure", error: rawResult });
    }
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
    // 消费审批通过的临时 extraAllow（retry 场景），消费后自动清除
    const extraAllow = permissionStore.takeExtraAllow(input.projectRoot);
    writeGuardSettings(input.capability.guardProfile, input.projectRoot, extraAllow.length > 0 ? extraAllow : undefined);

    // Claude Code agent 能力边界警告：
    // Claude Code 协议不支持"非白名单即审批"的实时权限交互。
    // 本 agent 实现层采用 denylist-only 策略——只拦截黑名单命令，非白名单操作由
    // Claude Code 自身启发式判断（安全命令自动放行，不产生 permission_denials）。
    // 这意味着 ACS 审批模型中的"非白名单 → permission_required"在此 agent 层
    // 仅对 Claude Code 主动拒绝的命令生效，不覆盖 Claude Code 自动放行的命令。
    logger.warn("ClaudeCode agent capability boundary: denylist-only mode active. " +
      "Non-whitelisted operations that Claude Code heuristically approves will NOT trigger ACS approval flow. " +
      "Only commands denied by Claude Code (matching deny list) are treated as security violations.");

    // 保存 GuardProfile 供 handleResultMessage 中 deny 列表匹配使用
    this.currentGuardProfile = input.capability.guardProfile;
    this.emittedToolCalls.clear();

    // 消费 ACP mcpServers：确保 CWD 的 .mcp.json 包含 MCP server 配置
    // Claude Code 通过 --mcp-config 绝对路径显式指定，写入 process.cwd() 与 --mcp-config 一致
    ensureMcpServers(input.capability.mcpServers, process.cwd());

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
    // - `--permission-mode default`: Claude Code 按 settings.local.json deny 列表拦截
    //   已知危险命令（denylist-only 策略）。deny 命中的工具写入 permission_denials，
    //   Snail Shell 检查是否匹配 deny 列表，匹配则报错，不匹配则忽略。
    //   未命中的工具由 Claude Code 自身启发式判断，安全命令自动放行。
    //   Claude Code 不支持实时权限交互，详见 guard-config.ts 翻译层注释。
    const args = [
      "-p",
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--permission-mode", "default",
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    // 显式传入 MCP 配置：消除 CWD 依赖，确保 agent 发现 set_final_body 等 MCP tool（additive，不替换其他来源）。
    args.push("--mcp-config", join(process.cwd(), ".mcp.json"));
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
      const stderrText = stderrTracker.text;
      const truncated = stderrText.length > 500 ? stderrText.slice(0, 500) + "..." : stderrText;
      throw new Error(`claude code returned no output events${stderrText ? ` (stderr: ${truncated})` : ""}`);
    }
    return { waitForStop: () => processController.waitForStop() };
  }

  private async readOutput(
    proc: ChildProcess,
    stdout: Readable,
    onEvent: (event: AgentEvent) => void,
    onResult: (content: string) => void,
    contextWindow?: number | null
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

      /**
       * 捕获 stdout stream 错误并 reject。
       * 当 stream 被 destroy（如进程被 kill）且无 error 处理器时，
       * Node.js 会触发 uncaughtException 并产生空错误对象 {}。
       * reject 而非 resolve：若 stream error 发生在已收到部分事件但无 result 的场景，
       * resolve 会把截断输出当作成功收口；reject 确保调用方感知到异常并走失败路径。
       */
      stdout.on("error", (error) => {
        logger.warn("ClaudeCode stdout stream error", { error: error.message });
        reject(new Error(`ClaudeCode stdout stream error: ${error.message}`));
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
 * 检查被拒工具是否命中 GuardProfile.deny 列表。
 * deny 列表使用 agent 原生模式格式：`Bash(pattern:*)` 或 `ToolName`。
 */
function isCommandInDenyPatterns(command: string | undefined, toolName: string, guard: GuardProfile): boolean {
  const denyList = guard.deny.map((p) => p.toLowerCase());
  const normalizedCmd = command?.toLowerCase().trim();

  return denyList.some((pattern) => {
    // 非 Bash 工具 deny：精确工具名匹配（如 deny "WebSearch" 匹配 tool_name "WebSearch"）
    if (!pattern.startsWith("bash(")) {
      return toolName.toLowerCase() === pattern;
    }
    // Bash 工具 deny：提取命令前缀进行匹配
    const m = /^bash\((.*):\*\)$/i.exec(pattern);
    if (!m) return false;
    const prefix = m[1].toLowerCase();
    // 无命令文本时，检查 tool_name 级别（Bash 自身被 deny）
    if (!normalizedCmd) return false;
    // 直接前缀匹配
    if (normalizedCmd.startsWith(prefix)) return true;
    // 子命令形式（如 deny pattern `push --force main` 匹配 `git push --force main`）
    for (const toolPrefix of ["git ", "npm ", "npx ", "pip ", "pip3 "]) {
      if (normalizedCmd.startsWith(toolPrefix + prefix)) return true;
    }
    return false;
  });
}
