import { spawn, ChildProcess } from "child_process";
import { Readable } from "stream";
import {
  Agent,
  AgentMessage,
  AgentReply,
  AgentEvent,
  ToolPermissionRequest,
  PermissionDecision,
} from "./interface";

export class ClaudeCodeAgent implements Agent {
  readonly name = "claude-code";

  async chat(messages: AgentMessage[]): Promise<AgentReply> {
    return this.chatStream(
      messages,
      () => {},
      async () => "deny"
    );
  }

  async chatStream(
    messages: AgentMessage[],
    onEvent: (event: AgentEvent) => void,
    onPermissionNeeded: (request: ToolPermissionRequest) => Promise<PermissionDecision>
  ): Promise<AgentReply> {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    let resultContent = "";
    let stderr = "";

    // Read stderr for debugging
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Start reading stdout
    const outputDone = this.readOutput(proc, proc.stdout!, onEvent, onPermissionNeeded, (content) => {
      resultContent = content;
    });

    // Send user messages as initial input
    const userContent = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");

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
      proc.on("close", () => resolve());
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
    onPermissionNeeded: (request: ToolPermissionRequest) => Promise<PermissionDecision>,
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
                  onEvent({
                    type: "tool_use",
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  });

                  // Ask for permission asynchronously
                  const request: ToolPermissionRequest = {
                    tool_use_id: block.id,
                    tool_name: block.name,
                    tool_input: block.input,
                  };

                  // Start permission handling in background
                  // Note: onPermissionNeeded callback will trigger the permission-required event
                  // We don't await this because we want to continue processing other messages
                  this.handlePermission(proc, request, onPermissionNeeded).catch((err) => {
                    console.error("Permission handling error:", err);
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
              resolve();
              break;
            }
          }
        }
      });

      stdout.on("end", () => resolve());
    });
  }

  private async handlePermission(
    proc: ChildProcess,
    request: ToolPermissionRequest,
    onPermissionNeeded: (request: ToolPermissionRequest) => Promise<PermissionDecision>
  ): Promise<void> {
    // Get the decision from the external handler
    // The onPermissionNeeded callback (from session/manager.ts) will:
    // 1. Store the pending permission in its own pendingPermissions map
    // 2. Emit the permission-required event
    // 3. Return a promise that resolves when the user responds
    const decision = await onPermissionNeeded(request);

    // Send the decision back to claude
    if (decision === "allow") {
      this.writeStdin(proc, {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: request.tool_use_id,
              content: "Permission granted.",
            },
          ],
        },
      });
    } else {
      this.writeStdin(proc, {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: request.tool_use_id,
              content: "Permission denied by user.",
              is_error: true,
            },
          ],
        },
      });
    }
  }

  private writeStdin(proc: ChildProcess, data: unknown): void {
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(JSON.stringify(data) + "\n");
    }
  }
}
