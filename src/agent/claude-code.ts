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

    const pendingPermissions = new Map<
      string,
      { resolve: (decision: PermissionDecision) => void; request: ToolPermissionRequest }
    >();

    let resultContent = "";
    let stderr = "";

    // Read stderr for debugging
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Start reading stdout
    const outputDone = this.readOutput(proc.stdout!, onEvent, pendingPermissions, onPermissionNeeded, (content) => {
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

    // Handle permission requests: listen for decisions and feed them back
    const permissionLoop = this.handlePermissions(proc, pendingPermissions);

    await Promise.all([outputDone, permissionLoop]);

    await new Promise<void>((resolve) => {
      proc.on("close", () => resolve());
    });

    if (proc.exitCode !== 0 && !resultContent) {
      throw new Error(`claude code exited with code ${proc.exitCode}: ${stderr}`);
    }

    return { content: resultContent };
  }

  private async readOutput(
    stdout: Readable,
    onEvent: (event: AgentEvent) => void,
    pendingPermissions: Map<string, { resolve: (d: PermissionDecision) => void; request: ToolPermissionRequest }>,
    onPermissionNeeded: (request: ToolPermissionRequest) => Promise<PermissionDecision>,
    onResult: (content: string) => void
  ): Promise<void> {
    return new Promise((resolve) => {
      let buffer = "";

      stdout.on("data", async (data: Buffer) => {
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

                  // Check if this tool use was denied (permission_denials in result)
                  // We'll handle it proactively: ask for permission
                  const request: ToolPermissionRequest = {
                    tool_use_id: block.id,
                    tool_name: block.name,
                    tool_input: block.input,
                  };
                  onEvent({ type: "permission_required", request });

                  const decisionPromise = new Promise<PermissionDecision>((res) => {
                    pendingPermissions.set(block.id, { resolve: res, request });
                  });

                  // Trigger external permission handler
                  const decision = await onPermissionNeeded(request);
                  const pending = pendingPermissions.get(block.id);
                  if (pending) {
                    pending.resolve(decision);
                    pendingPermissions.delete(block.id);
                  }
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

  private async handlePermissions(
    proc: ChildProcess,
    pendingPermissions: Map<string, { resolve: (d: PermissionDecision) => void; request: ToolPermissionRequest }>
  ): Promise<void> {
    // This loop waits for permission decisions and sends them back via stdin
    while (proc.stdin && !proc.stdin.destroyed) {
      const entry = pendingPermissions.values().next().value;
      if (!entry) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      const decision = await new Promise<PermissionDecision>((resolve) => {
        // Check if already resolved
        const existing = [...pendingPermissions.entries()].find(([, v]) => v === entry);
        if (!existing) {
          resolve("deny");
          return;
        }
        // The resolve will be called by readOutput's onPermissionNeeded
        entry.resolve = resolve;
      });

      if (decision === "allow") {
        this.writeStdin(proc, {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: entry.request.tool_use_id,
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
                tool_use_id: entry.request.tool_use_id,
                content: "Permission denied by user.",
                is_error: true,
              },
            ],
          },
        });
      }
    }
  }

  private writeStdin(proc: ChildProcess, data: unknown): void {
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(JSON.stringify(data) + "\n");
    }
  }
}
