import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import type { Readable } from "stream";
import type {
  AgentInvocationResult,
  AgentEvent,
  SnailRuntime,
  SnailRuntimeTurnInput,
  StatelessAgentInvoker,
  StatelessInvocationInput,
} from "./interface";
import { logger } from "../logger";
import { buildStatelessMessages } from "./prompt-mapper";
import { formatText } from "./log-preview";

export class ClaudeCodeAgent implements SnailRuntime, StatelessAgentInvoker {
  readonly name = "claude-code";
  readonly runtime = "claude-code-cli";

  async invokeTurn(input: SnailRuntimeTurnInput, onEvent: (event: AgentEvent) => void): Promise<AgentInvocationResult> {
    // Claude Code stays on the stateless path. Snail Shell reconstructs the per-turn
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
    const { messages, systemPrompt } = input;
    // Claude Code CLI is integrated in strict single-turn mode.
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

    const proc = spawn(
      "claude",
      args,
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    let resultContent = "";
    let stderr = "";

    // Read stderr for debugging
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      logger.debug("ClaudeCode stderr", { chunk: formatText(data.toString()) });
    });

    // Start reading stdout
    const outputDone = this.readOutput(proc, proc.stdout!, onEvent, (content) => {
      resultContent = content;
    });

    // Send user messages as initial input
    const userContent = messages
      .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
      .join("\n\n");

    this.writeStdin(proc, {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: userContent }] },
    });

    // Wait for output to finish
    await outputDone;

    // Close stdin to signal end of input
    proc.stdin?.end();

    // Wait for process to close
    await new Promise<void>((resolve) => {
      proc.on("close", (code, signal) => {
        logger.debug("ClaudeCode process closed", { code, signal, stderrPreview: formatText(stderr) });
        resolve();
      });
    });

    if (proc.exitCode !== 0 && !resultContent) {
      throw new Error(`claude code exited with code ${proc.exitCode}: ${stderr}`);
    }

    return { content: resultContent };
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
          let msg: any;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }

          switch (msg.type) {
            case "assistant": {
              for (const block of msg.message?.content ?? []) {
                if (block.type === "text") {
                  onEvent({ type: "streaming_chunk", content: block.text });
                } else if (block.type === "tool_use") {
                  // With bypassPermissions mode, tools are automatically allowed
                  // Still emit the tool_use event for UI display
                  onEvent({
                    type: "tool_use",
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  });
                }
              }
              break;
            }
            case "result": {
              if (msg.result) {
                onResult(msg.result);
                onEvent({ type: "content", content: msg.result });
              }
              if (msg.is_error) {
                onEvent({ type: "error", error: msg.result });
              }
              // Resolve immediately when we get the result
              resolve();
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
}
