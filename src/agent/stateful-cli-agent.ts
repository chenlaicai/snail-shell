import { spawn } from "child_process";
import type {
  AgentEvent,
  AgentInvocationResult,
  AgentMessage,
  StatefulInvocationInput,
} from "./interface";
import { logger } from "../logger";

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
  };

  /** 其他 CLI 特定字段 */
  [key: string]: unknown;
}

export interface ParseState {
  buffer: string;
  rawOutput: string[];
  textChunks: string[];
  finalText: string | null;
  sessionId: string | null;
}

export interface CLIConfig {
  command: string;
  buildArgs: (input: StatefulInvocationInput, prompt: string) => string[];
  timeoutMs?: number;
}

export abstract class StatefulCLIAgent {
  protected abstract getAgentName(): string;
  protected abstract getCLIConfig(): CLIConfig;

  async invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void
  ): Promise<AgentInvocationResult> {
    const prompt = this.buildPrompt(input);
    const config = this.getCLIConfig();
    const args = config.buildArgs(input, prompt);

    this.logInvocationStart(input, prompt, args);
    const { exitCode, stderr, state } = await this.executeCLI(config, args, input.sessionId, onEvent);
    this.logProcessClosed(exitCode, stderr, state.sessionId);

    if (exitCode !== 0) {
      throw new Error(`${config.command} exited with code ${exitCode}: ${stderr || state.rawOutput.join("")}`);
    }

    const reply = this.finalizeReply(state);
    this.logInvocationResult(reply, state);
    onEvent({ type: "result", content: reply });
    return { content: reply, sessionId: state.sessionId };
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
      sessionId,
    };
  }

  protected async executeCLI(
    config: CLIConfig,
    args: string[],
    sessionId: string | null,
    onEvent: (event: AgentEvent) => void
  ): Promise<{ exitCode: number | null; stderr: string; state: ParseState }> {
    const proc = spawn(config.command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    const state = this.createParseState(sessionId);

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.consumeOutput(state, chunk.toString(), onEvent);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      logger.debug(`${this.getAgentName()} stderr`, { chunk: this.previewText(text) });
    });

    const timeoutMs = config.timeoutMs ?? 30 * 60 * 1000; // Default 30 minutes
    const timeoutHandle = setTimeout(() => {
      logger.warn(`${this.getAgentName()} process timeout, killing process`, { timeoutMs });
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          logger.warn(`${this.getAgentName()} process did not respond to SIGTERM, sending SIGKILL`);
          proc.kill("SIGKILL");
        }
      }, 5000);
    }, timeoutMs);

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      proc.on("error", (error: Error) => {
        clearTimeout(timeoutHandle);
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(new Error(`${config.command} CLI not found. Please install it and ensure '${config.command}' is in your PATH.`));
        } else {
          reject(new Error(`Failed to spawn ${config.command} process: ${error.message}`));
        }
      });
      proc.on("close", (code) => {
        clearTimeout(timeoutHandle);
        resolve(code);
      });
    });

    this.flushOutput(state, onEvent);
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
      logger.warn(`Failed to parse ${this.getAgentName()} JSON output`, { line: this.previewText(trimmed), error });
      return;
    }

    this.extractSessionId(state, event);

    const mappedEvents = this.mapEvent(event, state);
    for (const mappedEvent of mappedEvents) {
      onEvent(mappedEvent);
    }
  }

  protected extractSessionId(state: ParseState, event: StreamEvent): void {
    if (typeof event.sessionID === "string" && event.sessionID) {
      state.sessionId = event.sessionID;
      logger.debug(`${this.getAgentName()} session updated`, { sessionId: state.sessionId });
    }
  }

  protected mapEvent(event: StreamEvent, state: ParseState): AgentEvent[] {
    if (event.type === "text") {
      const text = typeof event.part?.text === "string" ? event.part.text : "";
      if (!text) {
        return [];
      }
      state.textChunks.push(text);
      state.finalText = state.textChunks.join("");
      logger.debug(`${this.getAgentName()} text event`, { contentPreview: this.previewText(text) });
      return [{ type: "text", content: text }];
    }

    if (event.type === "tool_use") {
      return this.mapToolUseEvent(event);
    }

    if (event.type === "step_finish") {
      const error = this.extractToolError(event.part);
      logger.debug(`${this.getAgentName()} step_finish event`, { hasError: Boolean(error) });
      return error ? [{ type: "error", error }] : [];
    }

    return [];
  }

  protected mapToolUseEvent(event: StreamEvent): AgentEvent[] {
    const part = event.part;
    if (!part) {
      return [];
    }

    const input = this.isRecord(part.state?.input) ? part.state.input : {};
    const events: AgentEvent[] = [{
      type: "tool_use",
      id: typeof part.callID === "string" ? part.callID : "tool-use",
      name: typeof part.tool === "string" ? part.tool : "tool",
      input,
    }];

    logger.debug(`${this.getAgentName()} tool_use event`, {
      toolName: typeof part.tool === "string" ? part.tool : "tool",
      toolInputPreview: this.previewText(JSON.stringify(input)),
    });

    const error = this.extractToolError(part);
    if (error) {
      events.push({ type: "error", error });
    }

    return events;
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
  public finalizeReply(state: ParseState): string {
    const reply = state.finalText ?? state.textChunks.join("");
    if (!reply.trim()) {
      throw new Error(`${this.getAgentName()} returned no reply content`);
    }
    return reply;
  }

  protected isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  protected previewText(text: string, maxLength = 500): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength)}...`;
  }

  protected summarizeArgs(args: string[]): string[] {
    return args.map((arg, index) => (index === args.length - 1 ? this.previewText(arg, 200) : arg));
  }

  protected logInvocationStart(input: StatefulInvocationInput, prompt: string, args: string[]): void {
    logger.info(`${this.getAgentName()} invokeStateful start`, {
      sessionId: input.sessionId,
      hasBootstrap: Boolean(input.bootstrap),
      bootstrapMessageCount: input.bootstrap?.messages.length ?? 0,
      incrementalMessageCount: input.incrementalMessages.length,
      incrementalMessagePreview: this.previewText(input.incrementalMessages.map((message) => message.content).join("\n\n")),
      promptPreview: this.previewText(prompt),
      args: this.summarizeArgs(args),
    });
  }

  protected logProcessClosed(exitCode: number | null, stderr: string, sessionId: string | null): void {
    logger.info(`${this.getAgentName()} process closed`, {
      exitCode,
      sessionId,
      stderrPreview: this.previewText(stderr),
    });
  }

  protected logInvocationResult(reply: string, state: ParseState): void {
    logger.info(`${this.getAgentName()} invokeStateful result`, {
      sessionId: state.sessionId,
      replyPreview: this.previewText(reply),
      textChunkCount: state.textChunks.length,
    });
  }
}
