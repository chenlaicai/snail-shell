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
  SnailRuntime,
  SnailRuntimeMessageInput,
  StatefulAgentInvoker,
  StatefulInvocationInput,
  ToolPermissionRequest,
} from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages } from "./prompt-mapper";
import { manageInvocationProcess } from "./managed-process";
import { logger } from "../logger";
import { formatText } from "./log-preview";
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

/**
 * Claude Code 有状态 Agent
 *
 * 支持会话恢复（resume）的 Claude Code CLI 封装。
 * 与无状态的 ClaudeCodeAgent 不同，此 agent 会维护会话状态，
 * 允许跨多轮对话保持上下文。
 *
 * 实现特点：
 * - 不继承 StatefulCLIAgent，因为 Claude Code 通过 stdin 传递 JSON 消息，
 *   而非命令行参数传递 prompt
 * - 使用 --resume <sessionId> 恢复会话
 * - 使用 --input-format stream-json 和 --output-format stream-json
 * - 系统提示词作为用户消息前缀注入，保留 Claude 内置 system prompt
 *
 * 使用场景：
 * - 需要长时间运行的任务
 * - 需要跨多轮对话的工作
 * - 需要利用 Claude Code 自身的会话管理能力
 */
export class ClaudeCodeStatefulAgent implements SnailRuntime, StatefulAgentInvoker {
  readonly name = "claude-code-stateful";
  readonly runtime = "claude-code-stateful-cli";

  /** 当前 invocation 的 GuardProfile，供 handleResultMessage 区分 hard/soft denial。 */
  private currentGuardProfile: GuardProfile | null = null;
  /** 当前 invocation 已发射的 tool_call，按 call_id 索引，供 denial 分类时还原命令。 */
  private emittedToolCalls = new Map<string, TrackedToolCall>();

  constructor(
    private readonly spawnFn: typeof spawn = spawn,
  ) {}

  private emitEvent(onEvent: (event: AgentEvent) => void, event: AgentEvent): void {
    logger.debug("ClaudeCodeStateful mapped event", { event });
    onEvent(event);
  }

  private logStdoutLine(line: string): void {
    logger.debug("ClaudeCodeStateful stdout raw line", { line: formatText(line) });
  }

  private parseStdoutMessage(line: string): any | null {
    try {
      return JSON.parse(line);
    } catch (error) {
      logger.warn("ClaudeCodeStateful failed to parse stdout line", { line: formatText(line), error });
      return null;
    }
  }

  private logStdoutMessage(msg: any): void {
    logger.debug("ClaudeCodeStateful stdout message", {
      type: msg?.type,
      message: msg,
    });
  }

  async invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions
  ): Promise<AgentInvocationResult> {
    const sessionId = input.externalSessionId;
    let bootstrap = sessionId ? null : buildStatefulBootstrap(input);
    if (bootstrap) {
      bootstrap = {
        ...bootstrap,
        systemPrompt: input.capability.systemPrompt,
      };
    }

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
    logger.warn("ClaudeCodeStateful agent capability boundary: denylist-only mode active. " +
      "Non-whitelisted operations that Claude Code heuristically approves will NOT trigger ACS approval flow. " +
      "Only commands denied by Claude Code (matching deny list) flow into classifyDenials → permission_required.");

    // 保存 GuardProfile 供 handleResultMessage 中 classifyDenials 使用
    this.currentGuardProfile = input.capability.guardProfile;
    this.emittedToolCalls.clear();

    // 消费 ACP mcpServers：确保 CWD 的 .mcp.json 包含 MCP server 配置
    ensureMcpServers(input.capability.mcpServers);

    return this.invokeStateful(
      {
        sessionId,
        bootstrap,
        incrementalMessages: buildStatefulIncrementalMessages(input),
        systemReminder: input.capability.systemReminder,
      },
      onEvent,
      options,
      input.projectRoot,
    );
  }

  async invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options: AgentInvocationOptions = {},
    cwd?: string,
  ): Promise<AgentInvocationResult> {
    let promptFilePath: string | null = null;
    if (input.bootstrap?.systemPrompt) {
      promptFilePath = join(tmpdir(), `snail-system-prompt-${randomUUID()}.txt`);
      writeFileSync(promptFilePath, input.bootstrap.systemPrompt, "utf-8");
    }
    const args = this.buildArgs(input, options, promptFilePath);
    const { proc, processController } = this.spawnClaudeProcess(args, options, cwd);
    const state = this.createInvocationState(input.sessionId);

    const closeDone = this.setupCloseHandler(proc, processController, state, promptFilePath);
    this.setupStderrHandler(proc, state);
    const outputDone = this.setupOutputHandler(proc, onEvent, state, options.contextWindow);
    this.sendUserInput(proc, input, args);

    await outputDone;
    proc.stdin?.end();
    await closeDone;
    await processController.throwIfStopped();
    this.validateResult(proc, state);

    return { sessionId: state.sessionId, waitForStop: () => processController.waitForStop() };
  }

  private buildArgs(input: StatefulInvocationInput, options: AgentInvocationOptions, promptFilePath: string | null): string[] {
    // Claude Code agent 层采用 denylist-only 策略：
    // - --permission-mode default：Claude Code 按 settings.local.json 的 deny 列表拦截
    // - deny 命中的工具 → permission_denials → Snail Shell classifyDenials 分拣
    // - 未命中的工具 → Claude Code 自身启发式判断（安全命令自动放行）
    // - 不支持实时权限交互（暂停→上报→等待→继续），详见 guard-config.ts 翻译层注释
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--permission-mode", "default",
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    // 显式传入 MCP 配置：消除 CWD 依赖，确保 agent 能发现 set_final_body 等 MCP tool。
    args.push("--mcp-config", join(process.cwd(), ".mcp.json"));

    if (input.sessionId) {
      args.push("--resume", input.sessionId);
    }

    // systemPrompt（静态规则）通过 --append-system-prompt-file 追加到 Claude 内置 prompt
    // 仅在首次调用（bootstrap）时注入，resume 时不重复注入
    if (promptFilePath) {
      args.push("--append-system-prompt-file", promptFilePath);
    }

    return args;
  }

  private spawnClaudeProcess(args: string[], options: AgentInvocationOptions, cwd?: string) {
    const proc = this.spawnFn(
      "claude",
      args,
      { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true }
    );

    /**
     * 捕获 spawn 错误（如命令不存在、权限不足等）。
     * 无此处理器时，错误会变成 uncaughtException 且错误对象可能是空对象 {}。
     */
    proc.on("error", (error) => {
      logger.error("ClaudeCodeStateful spawn error", { error });
    });

    const processController = manageInvocationProcess({
      proc,
      agentName: "ClaudeCodeStateful",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    return { proc, processController };
  }

  private createInvocationState(initialSessionId: string | null) {
    return {
      resultContent: "",
      outputEventCount: 0,
      stderr: "",
      sessionId: initialSessionId,
    };
  }

  private setupCloseHandler(proc: ChildProcess, processController: any, state: any, promptFilePath: string | null): Promise<void> {
    return new Promise<void>((resolve) => {
      proc.on("close", (code, signal) => {
        processController.cleanup();
        if (promptFilePath) { try { unlinkSync(promptFilePath); } catch { /* cleanup failure is non-fatal */ } }
        logger.debug("ClaudeCodeStateful process closed", { code, signal, stderrPreview: formatText(state.stderr) });
        resolve();
      });
    });
  }

  private setupStderrHandler(proc: ChildProcess, state: any): void {
    proc.stderr?.on("data", (data: Buffer) => {
      state.stderr += data.toString();
      logger.debug("ClaudeCodeStateful stderr", { chunk: formatText(data.toString()) });
    });
  }

  private setupOutputHandler(proc: ChildProcess, onEvent: (event: AgentEvent) => void, state: any, contextWindow?: number | null): Promise<void> {
    return this.readOutput(proc, proc.stdout!, {
      onEvent: (event) => {
        if (isOutputEvent(event)) state.outputEventCount += 1;
        onEvent(event);
      },
      onResult: (content) => {
        state.resultContent = content;
      },
      onSessionId: (extractedSessionId) => {
        if (extractedSessionId) {
          state.sessionId = extractedSessionId;
        }
      },
    }, contextWindow);
  }

  private sendUserInput(proc: ChildProcess, input: StatefulInvocationInput, args: string[]): void {
    const userContent = this.buildUserContent(input);

    logger.debug("ClaudeCodeStateful invocation", {
      args,
      sessionId: input.sessionId,
      hasBootstrap: !!input.bootstrap,
      incrementalMessageCount: input.incrementalMessages.length,
      transcriptSize: userContent.length,
    });

    this.writeStdin(proc, {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: userContent }] },
    });
  }

  private validateResult(proc: ChildProcess, state: any): void {
    if (proc.exitCode !== 0 && !state.resultContent) {
      throw new Error(`claude code stateful exited with code ${proc.exitCode}: ${state.stderr}`);
    }

    if (state.outputEventCount === 0) {
      const maxLen = 500;
      const truncated = state.stderr.length > maxLen ? state.stderr.slice(0, maxLen) + "..." : state.stderr;
      const diagnosticInfo = state.stderr ? ` (stderr: ${truncated})` : "";
      throw new Error(`claude code stateful returned no output events${diagnosticInfo}`);
    }
  }

  private async readOutput(
    proc: ChildProcess,
    stdout: Readable,
    callbacks: {
      onEvent: (event: AgentEvent) => void;
      onResult: (content: string) => void;
      onSessionId: (sessionId: string) => void;
    },
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
          this.extractSessionId(msg, callbacks.onSessionId);
          this.processMessage(msg, callbacks, resolve, contextWindow);
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
        logger.warn("ClaudeCodeStateful stdout stream error", { error: error.message });
        reject(new Error(`ClaudeCodeStateful stdout stream error: ${error.message}`));
      });

      stdout.on("end", () => resolve());
    });
  }

  private processMessage(
    msg: any,
    callbacks: {
      onEvent: (event: AgentEvent) => void;
      onResult: (content: string) => void;
    },
    resolve: () => void,
    contextWindow?: number | null
  ): void {
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

  private extractSessionId(msg: any, onSessionId: (sessionId: string) => void): void {
    // 尝试从顶层 session_id 提取
    if (typeof msg.session_id === "string" && msg.session_id) {
      onSessionId(msg.session_id);
    }
    // 尝试从 sessionID 提取（兼容其他格式）
    if (typeof msg.sessionID === "string" && msg.sessionID) {
      onSessionId(msg.sessionID);
    }
  }

  private handleAssistantMessage(msg: any, onEvent: (event: AgentEvent) => void): void {
    const messageId = msg.message?.id ?? null;
    for (const block of msg.message?.content ?? []) {
      if (block.type === "text") {
        this.emitTextBlock(block, messageId, onEvent);
      } else if (block.type === "tool_use") {
        this.emitToolUseBlock(block, messageId, onEvent);
      }
    }
  }

  private emitTextBlock(block: any, messageId: string | null, onEvent: (event: AgentEvent) => void): void {
    this.emitEvent(onEvent, {
      type: "message_event",
      event: {
        kind: "text",
        payload: { text: block.text, mentions: [] },
        source: { runtime_event_type: "assistant", runtime_message_id: messageId },
      },
    });
  }

  private emitToolUseBlock(block: any, messageId: string | null, onEvent: (event: AgentEvent) => void): void {
    /** 跟踪 tool_call 供 denial 分类时还原完整命令文本 */
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
        source: {
          runtime_event_type: "assistant",
          runtime_message_id: messageId,
          runtime_call_id: block.id ?? null,
        },
      },
    });
  }

  private handleResultMessage(msg: any, onEvent: (event: AgentEvent) => void, onResult: (content: string) => void, contextWindow?: number | null): void {
    const rawResult = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
    const permissionDenials: unknown[] = Array.isArray(msg.permission_denials) ? msg.permission_denials : [];

    logger.debug("ClaudeCodeStateful result message", {
      isError: msg.is_error,
      subtype: msg.subtype,
      durationMs: msg.duration_ms,
      durationApiMs: msg.duration_api_ms,
      result: formatText(rawResult),
      permissionDenialCount: permissionDenials.length,
    });

    if (msg.result) {
      logger.debug("ClaudeCodeStateful final result content", {
        result: formatText(rawResult),
      });
      onResult(rawResult);
    }

    const usage = usageDetailFromClaudeResult(msg, contextWindow);
    if (usage) this.emitEvent(onEvent, { type: "message_event", event: buildRuntimeUsageSignal(usage, "result") });

    if (permissionDenials.length > 0) {
      const { hardDenials, softDenials } = this.classifyDenials(permissionDenials);

      /** 硬拒绝（黑名单匹配）：报错 + message_failure。hard denial 优先——同一 result 中存在 hard denial 时，跳过 soft denial 处理，避免失败消息仍被展示审批请求。 */
      if (hardDenials.length > 0) {
        const hardMsg = this.formatDenialMessage(hardDenials);
        this.emitEvent(onEvent, { type: "message_event", event: { kind: "error", payload: { source: "runtime", message: hardMsg, detail: null }, source: { runtime_event_type: "result" } } });
        this.emitEvent(onEvent, { type: "message_failure", error: hardMsg });
        return;
      }

      /**
       * 软拒绝（不在黑白名单中）：denylist-only 策略下不发射 permission_required。
       *
       * Claude Code 协议不支持实时权限交互，非交互模式下对不在任一列表的命令自行判断。
       * 部分工具（如 AskUserQuestion）在非交互模式下仍会产生 permission_denials，但
       * 这些不是安全威胁，而是 agent 能力边界——让 Claude Code 自行降级处理即可。
       * 发射 permission_required 会导致用户看到无意义的审批弹窗且无法有效重试。
       */
      logger.debug("ClaudeCodeStateful soft denials ignored (denylist-only mode)", {
        tools: softDenials.map((d) => String((d as Record<string, unknown>)?.tool_name ?? "unknown")),
      });
      return;
    }

    if (msg.is_error) {
      this.emitEvent(onEvent, { type: "message_failure", error: rawResult });
    }
  }

  /**
   * 将被拒工具分为硬拒绝（匹配 denyPatterns）和软拒绝（不在黑白名单中，需审批）。
   * 通过跟 GuardProfile.deny 列表的匹配结果区分。
   */
  private classifyDenials(denials: unknown[]): { hardDenials: unknown[]; softDenials: unknown[] } {
    const guard = this.currentGuardProfile;
    const hardDenials: unknown[] = [];
    const softDenials: unknown[] = [];

    for (const denial of denials) {
      const item = denial as Record<string, unknown>;
      const toolName = String(item?.tool_name ?? "");
      const toolUseId = String(item?.tool_use_id ?? item?.id ?? "");

      /** 尝试从已发射的 tool_call 中还原被拒工具的完整 input */
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
    logger.debug("ClaudeCodeStateful ignored stdout message", {
      type: msg?.type,
      message: msg,
    });
  }

  private writeStdin(proc: ChildProcess, data: unknown): void {
    if (proc.stdin && !proc.stdin.destroyed) {
      const written = proc.stdin.write(JSON.stringify(data) + "\n");
      if (!written) {
        proc.stdin.once('drain', () => {
          logger.debug("ClaudeCodeStateful stdin drained after backpressure");
        });
      }
    } else {
      logger.warn("ClaudeCodeStateful cannot write to stdin", { state: proc.stdin ? "destroyed" : "null" });
    }
  }

  /**
   * 构建用户消息内容。
   *
   * systemPrompt（静态规则）通过 --append-system-prompt-file 注入，不在此处重复。
   * systemReminder（动态上下文）仅在变化时注入。
   */
  private buildUserContent(input: StatefulInvocationInput): string {
    const parts: string[] = [];

    if (input.systemReminder) {
      parts.push(`<system-reminder>\n${input.systemReminder}\n</system-reminder>`);
    }

    if (input.bootstrap) {
      for (const message of input.bootstrap.messages) {
        parts.push(message.content);
      }
    }

    for (const message of input.incrementalMessages) {
      parts.push(message.content);
    }

    return parts.join("\n\n");
  }
}

function isOutputEvent(event: AgentEvent): boolean {
  if (event.type !== "message_event") return false;
  return event.event.kind !== "signal" && event.event.kind !== "start";
}

/**
 * 判断被拒工具是否匹配 GuardProfile.deny 列表（硬拒绝）。
 * 支持两种 pattern：
 * - 非 Bash 工具：精确工具名匹配（如 deny "WebSearch" 匹配 tool_name "WebSearch"）
 * - Bash 工具：`Bash(command:*)` 前缀匹配（如 deny "Bash(rm -rf:*)" 匹配命令 "rm -rf /tmp/foo"）
 */
function isCommandInDenyPatterns(command: string | undefined, toolName: string, guard: GuardProfile): boolean {
  const denyList = guard.deny.map((p) => p.toLowerCase());
  const normalizedCmd = command?.toLowerCase().trim();

  return denyList.some((pattern) => {
    if (!pattern.startsWith("bash(")) {
      return toolName.toLowerCase() === pattern;
    }
    const m = /^bash\((.*):\*\)$/i.exec(pattern);
    if (!m) return false;
    const prefix = m[1].toLowerCase();
    if (!normalizedCmd) return false;
    if (normalizedCmd.startsWith(prefix)) return true;
    for (const toolPrefix of ["git ", "npm ", "npx ", "pip ", "pip3 "]) {
      if (normalizedCmd.startsWith(toolPrefix + prefix)) return true;
    }
    return false;
  });
}
