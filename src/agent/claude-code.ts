import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import type { Readable } from "stream";
import type {
  AgentInvocationResult,
  AgentEvent,
  SnailRuntime,
  SnailRuntimeMessageInput,
  StatelessAgentInvoker,
  StatelessInvocationInput,
} from "./interface";
import { logger } from "../logger";
import { buildStatelessMessages } from "./prompt-mapper";
import { formatText } from "./log-preview";
import { renderStatelessTranscript } from "./stateless-runtime-adapter";

export class ClaudeCodeAgent implements SnailRuntime, StatelessAgentInvoker {
  readonly name = "claude-code";
  readonly runtime = "claude-code-cli";

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

  private handleResultMessage(msg: any, onEvent: (event: AgentEvent) => void, onResult: (content: string) => void): void {
    const rawResult = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
    const permissionDenialError = this.formatPermissionDenials(msg.permission_denials);
    logger.debug("ClaudeCode result message", {
      isError: msg.is_error,
      subtype: msg.subtype,
      durationMs: msg.duration_ms,
      durationApiMs: msg.duration_api_ms,
      result: formatText(rawResult),
    });
    if (msg.result) {
      logger.debug("ClaudeCode final result content", {
        result: formatText(rawResult),
      });
      onResult(rawResult);
    }
    if (msg.is_error) {
      this.emitEvent(onEvent, { type: "message_failure", error: rawResult });
    }
    if (permissionDenialError) {
      this.emitEvent(onEvent, { type: "message_event", event: { kind: "error", payload: { source: "runtime", message: permissionDenialError, detail: null }, source: { runtime_event_type: "result" } } });
      this.emitEvent(onEvent, { type: "message_failure", error: permissionDenialError });
    }
  }

  private formatPermissionDenials(value: unknown): string | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const tools = value
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

  async invokeMessage(input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void): Promise<AgentInvocationResult> {
    // Claude Code stays on the stateless path. Snail Shell reconstructs the per-message
    // working context and Claude answers from that supplied window only.
    return this.invokeStateless(
      {
        systemPrompt: input.systemPrompts.conversation,
        messages: buildStatelessMessages(input),
      },
      onEvent
    );
  }

  async invokeStateless(
    input: StatelessInvocationInput,
    onEvent: (event: AgentEvent) => void,
  ): Promise<AgentInvocationResult> {
    const { systemPrompt } = input;
    // Claude Code CLI is integrated in strict single-message mode.
    // - `--no-session-persistence`: Snail Shell, not Claude, owns conversation state.
    // - `--output-format/--input-format stream-json`: required so we can map Claude's
    //   streaming protocol into Snail Shell's AgentEvent model.
    // - `--permission-mode bypassPermissions`: Snail Shell currently centralizes the
    //   approval policy. We intentionally bypass Claude's interactive approval layer
    //   because the `claude -p` path is not reliable enough for our shell-managed flow.
    const args = [
      "-p",
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--permission-mode", "bypassPermissions",
    ];

    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt);
    }

    const proc = this.spawnProcess(
      "claude",
      args,
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    let resultContent = "";
    let outputEventCount = 0;
    let stderr = "";

    const closeDone = new Promise<void>((resolve) => {
      proc.on("close", (code, signal) => {
        logger.debug("ClaudeCode process closed", { code, signal, stderrPreview: formatText(stderr) });
        resolve();
      });
    });

    // Read stderr for debugging
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      logger.debug("ClaudeCode stderr", { chunk: formatText(data.toString()) });
    });

    // Start reading stdout
    const outputDone = this.readOutput(proc, proc.stdout!, (event) => {
      if (isOutputEvent(event)) outputEventCount += 1;
      onEvent(event);
    }, (content) => {
      resultContent = content;
    });

    // Send user messages as initial input
    const userContent = this.renderUserContent(input.messages);

    logger.debug("ClaudeCode stateless invocation", {
      args,
      systemPrompt: formatText(systemPrompt ?? ""),
      transcriptSize: userContent.length,
    });

    this.writeStdin(proc, {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: userContent }] },
    });

    // Wait for output to finish
    await outputDone;

    // Close stdin to signal end of input
    proc.stdin?.end();

    await closeDone;

    if (proc.exitCode !== 0 && !resultContent) {
      throw new Error(`claude code exited with code ${proc.exitCode}: ${stderr}`);
    }

    if (outputEventCount === 0) {
      throw new Error("claude code returned no output events");
    }
    return {};
  }

  private async readOutput(
    proc: ChildProcess,
    stdout: Readable,
    onEvent: (event: AgentEvent) => void,
    onResult: (content: string) => void
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
              this.handleResultMessage(msg, onEvent, onResult);
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
