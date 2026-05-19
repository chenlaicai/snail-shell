import { spawn, type ChildProcess } from "child_process";
import type { Readable } from "stream";
import type {
  AgentEvent,
  AgentInvocationOptions,
  AgentInvocationResult,
  SnailRuntime,
  SnailRuntimeMessageInput,
  StatefulAgentInvoker,
  StatefulInvocationInput,
} from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages } from "./prompt-mapper";
import { manageInvocationProcess } from "./managed-process";
import { logger } from "../logger";
import { formatText } from "./log-preview";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "./runtime-usage";

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
 * - 只在首次调用时传递系统提示词（通过 --system-prompt）
 *
 * 使用场景：
 * - 需要长时间运行的任务
 * - 需要跨多轮对话的工作
 * - 需要利用 Claude Code 自身的会话管理能力
 */
export class ClaudeCodeStatefulAgent implements SnailRuntime, StatefulAgentInvoker {
  readonly name = "claude-code-stateful";
  readonly runtime = "claude-code-stateful-cli";

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
    const sessionId = input.conversation.runtime_sessions[input.snail.name]?.sessionId ?? null;
    return this.invokeStateful(
      {
        sessionId,
        bootstrap: sessionId ? null : buildStatefulBootstrap(input),
        incrementalMessages: buildStatefulIncrementalMessages(input),
      },
      onEvent,
      options
    );
  }

  async invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options: AgentInvocationOptions = {}
  ): Promise<AgentInvocationResult> {
    const args = this.buildArgs(input, options);
    const { proc, processController } = this.spawnClaudeProcess(args, options);
    const state = this.createInvocationState(input.sessionId);

    const closeDone = this.setupCloseHandler(proc, processController, state);
    this.setupStderrHandler(proc, state);
    const outputDone = this.setupOutputHandler(proc, onEvent, state, options.contextWindow);
    this.sendUserInput(proc, input, args);

    await outputDone;
    proc.stdin?.end();
    await closeDone;
    await processController.throwIfStopped();
    this.validateResult(proc, state);

    return { sessionId: state.sessionId };
  }

  private buildArgs(input: StatefulInvocationInput, options: AgentInvocationOptions): string[] {
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

    if (input.sessionId) {
      args.push("--resume", input.sessionId);
    }

    if (input.bootstrap?.systemPrompt) {
      // 覆盖 Claude 内置提示词，原因同 claude-code.ts stateless 变体
      args.push("--system-prompt", input.bootstrap.systemPrompt);
    }

    return args;
  }

  private spawnClaudeProcess(args: string[], options: AgentInvocationOptions) {
    const proc = this.spawnFn(
      "claude",
      args,
      { stdio: ["pipe", "pipe", "pipe"], detached: true }
    );

    const processController = manageInvocationProcess({
      proc,
      agentName: "ClaudeCodeStateful",
      signal: options.signal,
      invocationTimeoutMs: 30 * 60 * 1000,
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

  private setupCloseHandler(proc: ChildProcess, processController: any, state: any): Promise<void> {
    return new Promise<void>((resolve) => {
      proc.on("close", (code, signal) => {
        processController.cleanup();
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
          this.extractSessionId(msg, callbacks.onSessionId);
          this.processMessage(msg, callbacks, resolve, contextWindow);
        }
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
    const permissionDenialError = this.formatPermissionDenials(msg.permission_denials);

    logger.debug("ClaudeCodeStateful result message", {
      isError: msg.is_error,
      subtype: msg.subtype,
      durationMs: msg.duration_ms,
      durationApiMs: msg.duration_api_ms,
      result: formatText(rawResult),
    });

    if (msg.result) {
      logger.debug("ClaudeCodeStateful final result content", {
        result: formatText(rawResult),
      });
      onResult(rawResult);
    }

    const usage = usageDetailFromClaudeResult(msg, contextWindow);
    if (usage) {
      this.emitEvent(onEvent, { type: "message_event", event: buildRuntimeUsageSignal(usage, "result") });
    }

    if (msg.is_error) {
      this.emitEvent(onEvent, { type: "message_failure", error: rawResult });
    }

    if (permissionDenialError) {
      this.emitEvent(onEvent, {
        type: "message_event",
        event: {
          kind: "error",
          payload: { source: "runtime", message: permissionDenialError, detail: null },
          source: { runtime_event_type: "result" },
        },
      });
      this.emitEvent(onEvent, { type: "message_failure", error: permissionDenialError });
    }
  }

  private formatPermissionDenials(value: unknown): string | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const tools = value
      .map((item) =>
        typeof item === "object" && item !== null && "tool_name" in item
          ? String((item as { tool_name?: unknown }).tool_name ?? "unknown")
          : "unknown"
      )
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
   * 构建用户消息内容
   *
   * 将 bootstrap 和 incrementalMessages 合并为单个 Claude stdin 用户消息。
   * 有状态模式下，Claude Code 自己管理会话历史；Snail Shell 只传递
   * prompt-mapper 已经格式化好的消息内容，不再自行拼接 USER/ASSISTANT
   * transcript 外层标签，避免用户正文伪造或污染角色边界。
   *
   * 注意：系统提示词通过 --system-prompt 参数传递（覆盖 Claude 内置提示词），
   * 不包含在用户消息中，避免重复传递。
   */
  private buildUserContent(input: StatefulInvocationInput): string {
    const parts: string[] = [];

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
