import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Readable } from "stream";
import type { AgentRuntimePort } from "../../port";
import type { AgentRequest, AgentEvent, InvokeResult, InvokeOptions, Message } from "../../model";
import { manageInvocationProcess } from "../utils/managed-process";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "../utils/runtime-usage";
import { ensureMcpServers } from "../utils/mcp-config";
import { ensureSkillSymlinks } from "../utils/skill-symlinks";

/**
 * Claude Code stateful 适配器。
 *
 * 有状态 agent：首次调用通过 --append-system-prompt-file 注入 system prompt，
 * 后续调用通过 --resume sessionId 恢复会话。
 * 通过 stdin JSON 传递消息，通过 stdout stream-json 接收事件。
 */
export class ClaudeCodeStatefulAgent implements AgentRuntimePort {
  readonly name = "claude-code-stateful";

  constructor(
    private readonly spawnFn: typeof spawn = spawn,
  ) {}

  async invoke(
    request: AgentRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const { prompt, capabilities, security, messages, workspaceRoot, sessionId } = resolveRequest(request);

    // 注入 capabilities（首次调用）
    if (request.kind === "first_call") {
      ensureMcpServers(capabilities.mcpServers, workspaceRoot, "claude");
      ensureSkillSymlinks(workspaceRoot, capabilities.skills);
    }

    // 构建 CLI args
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

    // Security deny → --disallowedTools
    if (security.deny.length > 0) {
      args.push("--disallowedTools", ...security.deny);
    }

    // MCP 配置
    args.push("--mcp-config", join(workspaceRoot, ".claude", "mcp.json"));

    // Session resume
    if (sessionId) {
      args.push("--resume", sessionId);
    }

    // System prompt 文件注入（仅首次）
    let promptFilePath: string | null = null;
    const fullSystemPrompt = prompt.mcpContext
      ? prompt.systemPrompt + "\n\n" + prompt.mcpContext
      : prompt.systemPrompt;
    if (fullSystemPrompt && !sessionId) {
      promptFilePath = join(tmpdir(), `snail-system-prompt-${randomUUID()}.txt`);
      writeFileSync(promptFilePath, fullSystemPrompt, "utf-8");
      args.push("--append-system-prompt-file", promptFilePath);
    }

    // Spawn process
    const proc = this.spawnFn(
      "claude",
      args,
      { cwd: workspaceRoot, stdio: ["pipe", "pipe", "pipe"], detached: true, env: { ...process.env, ...options.contextEnv } }
    );

    const processController = manageInvocationProcess({
      proc,
      agentName: "ClaudeCodeStateful",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    let resultContent = "";
    let outputEventCount = 0;
    let extractedSessionId: string | null = null;
    const stderrTracker = { text: "" };

    const closeDone = new Promise<void>((resolve) => {
      proc.on("close", () => {
        processController.cleanup();
        if (promptFilePath) { try { unlinkSync(promptFilePath); } catch { /* non-fatal */ } }
        resolve();
      });
    });

    this.captureStderr(proc, stderrTracker);
    const outputDone = this.readOutput(proc, proc.stdout!, onEvent, (content) => {
      resultContent = content;
    }, (sid) => {
      extractedSessionId = sid;
    }, options.contextWindow);

    // 构建 user message
    this.sendUserMessage(proc, messages, prompt.systemReminder);

    await outputDone;
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

    return {
      sessionId: extractedSessionId,
      waitForStop: () => processController.waitForStop(),
    };
  }

  private async readOutput(
    proc: ChildProcess,
    stdout: Readable,
    onEvent: (event: AgentEvent) => void,
    onResult: (content: string) => void,
    onSessionId: (sessionId: string) => void,
    contextWindow?: number | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = "";

      stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = this.parseStdoutMessage(line);
          if (!msg) continue;

          // 提取 session_id
          if (msg.session_id || msg.sessionID) {
            onSessionId(msg.session_id ?? msg.sessionID);
          }

          switch (msg.type) {
            case "assistant":
              this.handleAssistantMessage(msg, onEvent);
              break;
            case "result":
              this.handleResultMessage(msg, onEvent, onResult, contextWindow);
              resolve();
              break;
            default:
              break;
          }
        }
      });

      stdout.on("error", (error) => {
        reject(new Error(`ClaudeCodeStateful stdout stream error: ${error.message}`));
      });

      stdout.on("end", () => resolve());
    });
  }

  private handleAssistantMessage(msg: any, onEvent: (event: AgentEvent) => void): void {
    for (const block of msg.message?.content ?? []) {
      if (block.type === "text") {
        onEvent({
          type: "message_event",
          event: {
            kind: "text",
            payload: { text: block.text, mentions: [] },
            source: { runtime_event_type: "assistant", runtime_message_id: msg.message?.id ?? null },
          },
        });
      } else if (block.type === "tool_use") {
        onEvent({
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
    if (msg.result) {
      onResult(rawResult);
    }

    const usage = usageDetailFromClaudeResult(msg, contextWindow);
    if (usage) onEvent(buildRuntimeUsageSignal(usage, "result"));

    if (msg.is_error) {
      onEvent({
        type: "message_event",
        event: {
          kind: "message_failure",
          payload: { error: rawResult },
          source: { runtime_event_type: "result", runtime_message_id: null },
        },
      });
    }
  }

  private captureStderr(proc: ChildProcess, tracker: { text: string }): void {
    proc.stderr?.on("data", (data: Buffer) => {
      tracker.text += data.toString();
    });
  }

  private writeStdin(proc: ChildProcess, data: unknown): void {
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(JSON.stringify(data) + "\n");
    }
  }

  private sendUserMessage(proc: ChildProcess, messages: Message[], systemReminder: string): void {
    const contentBlocks: Array<{ type: "text"; text: string }> = [];
    if (systemReminder) {
      contentBlocks.push({ type: "text", text: `<system-reminder>\n${systemReminder}\n</system-reminder>` });
    }

    // 消息格式化：speaker prefix + content
    for (const msg of messages) {
      const speaker = msg.speaker ? `${msg.speaker}:\n` : "";
      contentBlocks.push({ type: "text", text: `${speaker}${msg.content}` });
    }

    this.writeStdin(proc, {
      type: "user",
      message: { role: "user", content: contentBlocks },
    });
  }

  private parseStdoutMessage(line: string): any | null {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }
}

function resolveRequest(request: AgentRequest) {
  if (request.kind === "first_call") {
    return {
      prompt: request.prompt,
      capabilities: request.capabilities,
      security: request.security,
      messages: request.messages,
      workspaceRoot: request.workspaceRoot,
      sessionId: null as string | null,
    };
  }
  return {
    prompt: { systemPrompt: "", systemReminder: request.systemReminder, mcpContext: "" },
    capabilities: { skills: [] as any[], mcpServers: [] as any[] },
    security: { deny: [] as string[], allow: [] as string[] },
    messages: request.messages,
    workspaceRoot: request.workspaceRoot,
    sessionId: request.sessionId as string | null,
  };
}

export const agent = new ClaudeCodeStatefulAgent();
