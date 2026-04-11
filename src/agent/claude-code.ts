import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import type { Readable } from "stream";
import type {
  Agent,
  AgentMessage,
  AgentReply,
  AgentEvent,
} from "./interface";
import { logger } from "../logger";

export class ClaudeCodeAgent implements Agent {
  readonly name = "claude-code";

  async chat(messages: AgentMessage[], systemPrompt?: string): Promise<AgentReply> {
    return this.chatStream(
      messages,
      () => {},
      systemPrompt
    );
  }

  async chatStream(
    messages: AgentMessage[],
    onEvent: (event: AgentEvent) => void,
    systemPrompt?: string
  ): Promise<AgentReply> {
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
        logger.info("ClaudeCode process closed", { code, signal });
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
                  onEvent({ type: "text", content: block.text });
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
                onEvent({ type: "result", content: msg.result });
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
