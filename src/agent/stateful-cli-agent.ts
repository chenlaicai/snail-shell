import { spawn } from "child_process";
import { type AgentEvent, type AgentInvocationOptions, type AgentInvocationResult, type AgentMessage, type StatefulInvocationInput } from "./interface";
import { manageInvocationProcess, type ManagedProcessStopOptions } from "./managed-process";
import { logger } from "../logger";
import { formatText } from "./log-preview";
import { buildRuntimeUsageSignal, usageDetailFromOpenCodeTokens } from "./runtime-usage";

/**
 * CLI 输出的流式事件格式
 *
 * 不同 CLI 可能有不同的字段，使用 [key: string]: unknown 保持灵活性。
 * 子类可以通过 override extractSessionId() 和 mapEvent() 来处理特定格式。
 *
 * @example
 * // OpenCode 格式
 * {"type":"text","sessionID":"ses_123","part":{"type":"text","text":"Hello"}}
 *
 * // Gemini 格式
 * {"type":"text","sessionID":"ses_456","part":{"text":"World"}}
 */
export interface StreamEvent {
  /** 事件类型：text, tool_use, step_finish, init 等 */
  type?: string;

  /** 会话 ID，用于恢复会话（可能在顶层或 part 中） */
  sessionID?: string;

  /** 事件详细内容 */
  part?: StreamPart;

  /** 其他 CLI 特定字段 */
  [key: string]: unknown;
}

/**
 * 事件详细内容
 *
 * 包含文本内容、工具调用信息、状态等。
 */
export interface StreamPart {
  /** 内容类型：text, tool, step-finish 等 */
  type?: string;

  /** 文本内容（type=text 时） */
  text?: string;

  /** 工具名称（type=tool 时） */
  tool?: string;

  /** 工具调用 ID */
  callID?: string;

  /** 会话 ID（某些 CLI 在 part 中返回） */
  sessionID?: string;

  /** 工具调用状态 */
  state?: {
    /** 状态：completed, error 等 */
    status?: string;

    /** 工具输入参数 */
    input?: Record<string, unknown>;

    /** 错误消息（status=error 时） */
    error?: string;

    /** 工具输出（status=completed 时） */
    output?: string;
  };

  /** 其他 CLI 特定字段 */
  [key: string]: unknown;
}

export interface ParseState {
  buffer: string;
  rawOutput: string[];
  textChunks: string[];
  finalText: string | null;
  outputEventCount: number;
  sessionId: string | null;
}

export interface CLIConfig {
  command: string;
  model?: string;
  buildArgs: (input: StatefulInvocationInput, prompt: string) => string[];
  buildEnv?: () => NodeJS.ProcessEnv;
  timeoutMs?: number;
  stopOptions?: ManagedProcessStopOptions;
}

/**
 * 有状态 CLI Agent 抽象基类
 *
 * 适用范围：通过命令行参数传递 prompt 的 CLI agent（如 OpenCode、Gemini、Codex）
 *
 * 不适用场景：通过 stdin 传递消息的 CLI agent（如 Claude Code 的 --input-format stream-json 模式）
 *
 * 设计假设：
 * - CLI 命令接收 prompt 作为命令行参数（args.push(prompt)）
 * - CLI 输出为 JSON 流式格式（每行一个 JSON 对象）
 * - session ID 从输出流中提取
 *
 * 如果新的 CLI agent 不满足上述假设（如 Claude Code 需要通过 stdin 传递 JSON 消息），
 * 则不应继承此类，而应直接实现 SnailRuntime 和 StatefulAgentInvoker 接口。
 */
export abstract class StatefulCLIAgent {
  protected abstract getAgentName(): string;
  protected abstract getCLIConfig(model?: string): CLIConfig;

  async invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options: AgentInvocationOptions = {}
  ): Promise<AgentInvocationResult> {
    const prompt = this.buildPrompt(input);
    const config = this.getCLIConfig(options.model);
    if (!prompt.trim()) {
      /**
       * Stateful CLI 的空 prompt 会退化为各 CLI 自己的参数错误，无法暴露 Snail Shell 丢失增量输入的真实边界问题。
       * 在 spawn 前失败可以保留运行时名称，并让上层消息终态直接记录可诊断原因。
       */
      throw new Error(`${this.getAgentName()} invocation prompt is empty`);
    }
    const args = config.buildArgs(input, prompt);

    const { exitCode, stderr, state } = await this.executeCLI({ config, args, sessionId: input.sessionId, onEvent, options });

    if (exitCode !== 0) {
      throw new Error(`${config.command} exited with code ${exitCode}: ${stderr || state.rawOutput.join("")}`);
    }

    this.assertOutputEvents(state, stderr);
    return { sessionId: state.sessionId };
  }

  protected buildPrompt(input: StatefulInvocationInput): string {
    const parts: string[] = [];
    if (input.bootstrap) {
      parts.push(`SYSTEM:\n${input.bootstrap.systemPrompt}`);
      parts.push(...input.bootstrap.messages.map((message) => this.formatMessage(message)));
    }
    parts.push(...input.incrementalMessages.map((message) => this.formatMessage(message)));
    return parts.join("\n\n");
  }

  protected formatMessage(message: AgentMessage): string {
    return `${message.role.toUpperCase()}:\n${message.content}`;
  }

  protected createParseState(sessionId: string | null): ParseState {
    return {
      buffer: "",
      rawOutput: [],
      textChunks: [],
      finalText: null,
      outputEventCount: 0,
      sessionId,
    };
  }

  protected async executeCLI(input: { config: CLIConfig; args: string[]; sessionId: string | null; onEvent: (event: AgentEvent) => void; options?: AgentInvocationOptions }): Promise<{ exitCode: number | null; stderr: string; state: ParseState }> {
    const { config, args, sessionId, onEvent, options = {} } = input;
    const proc = spawn(config.command, args, {
      cwd: process.cwd(),
      env: config.buildEnv?.() ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    /**
     * 运行时终止必须先请求 CLI 自己收尾，再按超时逐级升级到强制终止。
     * 直接把消息标记终态会掩盖后台工具仍在运行的风险；因此这里跟踪完整终止细节，
     * 让上层消息生命周期能记录是否发生强杀以及 stateful session 是否应失效。
     */
    const processController = manageInvocationProcess({
      proc,
      agentName: this.getAgentName(),
      signal: options.signal,
      invocationTimeoutMs: config.timeoutMs ?? 30 * 60 * 1000,
      stopOptions: config.stopOptions,
    });

    let stderr = "";
    const state = this.createParseState(sessionId);

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.consumeOutput(state, chunk.toString(), onEvent);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      logger.debug(`${this.getAgentName()} stderr`, { chunk: formatText(text) });
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      proc.on("error", (error: Error) => {
        processController.cleanup();
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(new Error(`${config.command} CLI not found. Please install it and ensure '${config.command}' is in your PATH.`));
        } else {
          reject(new Error(`Failed to spawn ${config.command} process: ${error.message}`));
        }
      });
      proc.on("close", (code) => {
        processController.cleanup();
        resolve(code);
      });
    });

    this.flushOutput(state, onEvent);
    await processController.throwIfStopped();
    return { exitCode, stderr, state };
  }

  /**
   * Consume output chunk and parse stream events.
   *
   * @internal This method is public only for testing purposes. Do not call directly in production code.
   */
  public consumeOutput(
    state: ParseState,
    chunk: string,
    onEvent: (event: AgentEvent) => void
  ): void {
    state.rawOutput.push(chunk);
    state.buffer += chunk;
    const lines = state.buffer.split("\n");
    state.buffer = lines.pop() ?? "";

    for (const line of lines) {
      this.handleLine(state, line, onEvent);
    }
  }

  /**
   * Flush remaining buffer and parse any incomplete events.
   *
   * @internal This method is public only for testing purposes. Do not call directly in production code.
   */
  public flushOutput(state: ParseState, onEvent: (event: AgentEvent) => void): void {
    if (state.buffer.trim()) {
      this.handleLine(state, state.buffer, onEvent);
    }
    state.buffer = "";
  }

  protected handleLine(
    state: ParseState,
    line: string,
    onEvent: (event: AgentEvent) => void
  ): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch (error) {
      logger.warn(`Failed to parse ${this.getAgentName()} JSON output`, { line: formatText(trimmed), error });
      return;
    }

    this.extractSessionId(state, event);

    const mappedEvents = this.mapEvent(event, state);
    for (const mappedEvent of mappedEvents) {
      if (isOutputEvent(mappedEvent)) state.outputEventCount += 1;
      onEvent(mappedEvent);
    }
  }

  protected extractSessionId(state: ParseState, event: StreamEvent): void {
    if (typeof event.sessionID === "string" && event.sessionID) {
      state.sessionId = event.sessionID;
    }
  }

  protected mapEvent(event: StreamEvent, state: ParseState): AgentEvent[] {
    const mapper = this.eventMappers[event.type ?? ""];
    return mapper ? mapper.call(this, event, state) : [];
  }

  private readonly eventMappers: Record<string, (event: StreamEvent, state: ParseState) => AgentEvent[]> = {
    step_start: this.mapStepStartEvent,
    text: this.mapTextEvent,
    tool_use: this.mapToolUseEvent,
    step_finish: this.mapStepFinishEvent,
  };

  private mapStepStartEvent(): AgentEvent[] {
    return [{ type: "message_event", event: { kind: "signal", payload: { type: "step_start", reason: null, detail: null }, source: { runtime_event_type: "step_start" } } }];
  }

  private mapTextEvent(event: StreamEvent, state: ParseState): AgentEvent[] {
    const text = typeof event.part?.text === "string" ? event.part.text : "";
    if (!text) return [];
    state.textChunks.push(text);
    state.finalText = state.textChunks.join("");
    return [{ type: "message_event", event: { kind: "text", payload: { text, mentions: [] }, source: { runtime_event_type: "text" } } }];
  }

  private mapStepFinishEvent(event: StreamEvent): AgentEvent[] {
    const error = this.extractToolError(event.part);
    if (error) logger.debug(`${this.getAgentName()} step_finish with error`, { error });
    const reason = typeof event.part?.reason === "string" ? event.part.reason : (typeof event.reason === "string" ? event.reason : null);
    return [...this.buildRuntimeUsageEvents(event), this.buildStepFinishSignal(reason), ...this.buildOptionalRuntimeError(error)];
  }

  private buildRuntimeUsageEvents(event: StreamEvent): AgentEvent[] {
    const detail = usageDetailFromOpenCodeTokens(event.part?.tokens ?? event.tokens, this.getCLIConfig().model);
    if (!detail) return [];
    /**
     * Usage diagnostics must stay as signal events so a runtime that only reports token accounting
     * cannot satisfy the assistant output boundary by itself. This preserves failure detection for
     * zero-output sessions while still recording the context data needed to diagnose them.
     */
    return [{ type: "message_event", event: buildRuntimeUsageSignal(detail, "step_finish") }];
  }

  protected mapToolUseEvent(event: StreamEvent): AgentEvent[] {
    const part = event.part;
    if (!part) {
      return [];
    }

    const input = this.isRecord(part.state?.input) ? part.state.input : {};
    const callId = typeof part.callID === "string" ? part.callID : "tool-use";
    const toolName = typeof part.tool === "string" ? part.tool : "tool";
    const events: AgentEvent[] = [this.buildToolCallEvent(toolName, callId, input), ...this.buildToolResultEvents(part, toolName, callId)];

    logger.debug(`${this.getAgentName()} tool call event`, {
      toolName: typeof part.tool === "string" ? part.tool : "tool",
      toolInputPreview: formatText(JSON.stringify(input)),
    });

    const error = this.extractToolError(part);
    if (error) {
      events.push({ type: "message_event", event: { kind: "error", payload: { source: "tool", message: error, detail: null }, source: { runtime_event_type: "tool_use", runtime_call_id: callId } } });
    }

    return events;
  }

  private buildStepFinishSignal(reason: string | null): AgentEvent {
    return { type: "message_event", event: { kind: "signal", payload: { type: "step_finish", reason, detail: null }, source: { runtime_event_type: "step_finish" } } };
  }

  private buildOptionalRuntimeError(error: string | null): AgentEvent[] {
    return error ? [{ type: "message_event", event: { kind: "error", payload: { source: "runtime", message: error, detail: null }, source: { runtime_event_type: "step_finish" } } }] : [];
  }

  private buildToolCallEvent(toolName: string, callId: string, input: Record<string, unknown>): AgentEvent {
    return { type: "message_event", event: { kind: "tool_call", payload: { tool_name: toolName, call_id: callId, input, title: null }, source: { runtime_event_type: "tool_use", runtime_call_id: callId } } };
  }

  private buildToolResultEvents(part: StreamPart, toolName: string, callId: string): AgentEvent[] {
    if (part.state?.status !== "completed" && part.state?.status !== "error") return [];
    return [{ type: "message_event", event: { kind: "tool_result", payload: { tool_name: toolName, call_id: callId, is_error: part.state.status === "error", output_text: typeof part.state.output === "string" ? part.state.output : null, error_text: typeof part.state.error === "string" ? part.state.error : null, metadata: { status: part.state.status } }, source: { runtime_event_type: "tool_use", runtime_call_id: callId } } }];
  }

  protected extractToolError(part: StreamPart | undefined): string | null {
    if (!part?.state || part.state.status !== "error") {
      return null;
    }
    return typeof part.state.error === "string" && part.state.error
      ? part.state.error
      : `${this.getAgentName()} tool call failed`;
  }

  /**
   * Finalize and return the complete reply text.
   *
   * @internal This method is public only for testing purposes. Do not call directly in production code.
   */
  public assertOutputEvents(state: ParseState, stderr?: string): void {
    if (state.outputEventCount === 0) {
      const maxLen = 500;
      const truncated = (text: string) => text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
      const diagnosticInfo = [
        stderr ? `stderr: ${truncated(stderr)}` : null,
        state.rawOutput.length > 0 ? `rawOutput: ${truncated(state.rawOutput.join(""))}` : null,
      ].filter(Boolean).join("; ");
      const suffix = diagnosticInfo ? ` (${diagnosticInfo})` : "";
      throw new Error(`${this.getAgentName()} returned no output events${suffix}`);
    }
  }

  protected isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

}

function isOutputEvent(event: AgentEvent): boolean {
  if (event.type !== "message_event") return false;
  return event.event.kind !== "signal" && event.event.kind !== "start";
}
