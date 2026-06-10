import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Readable } from "stream";
import type { AgentRuntimePort } from "../../port";
import type { AgentRequest, AgentEvent, InvokeResult, InvokeOptions, SecuritySpec, Message } from "../../model";
import { manageInvocationProcess } from "../managed-process";
import { renderStatelessTranscript } from "../stateless-runtime-adapter";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "../runtime-usage";
import { ensureMcpServers } from "../mcp-config";
import { ensureSkillSymlinks } from "../skill-symlinks";

/**
 * Claude Code stateless 适配器。
 *
 * 每次调用都重建完整上下文窗口（FirstCallRequest）。
 * 通过 --append-system-prompt-file 注入 system prompt，
 * 通过 stdin JSON 传递对话历史，
 * 通过 stdout stream-json 接收事件。
 */
export class ClaudeCodeAgent implements AgentRuntimePort {
  readonly name = "claude-code";
  readonly runtime = "claude-code-cli";

  constructor(
    private readonly spawnProcess: typeof spawn = spawn,
  ) {}

  async invoke(
    request: AgentRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const { prompt, capabilities, security, messages, workspaceRoot } = resolveRequest(request);

    // 注入 capabilities（首次调用）
    ensureMcpServers(capabilities.mcpServers, workspaceRoot, "claude");
    ensureSkillSymlinks(workspaceRoot, capabilities.skills);

    // 构建 CLI args
    const args = [
      "-p",
      "--no-session-persistence",
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

    // System prompt 文件注入
    let promptFilePath: string | null = null;
    const fullSystemPrompt = prompt.mcpContext
      ? prompt.systemPrompt + "\n\n" + prompt.mcpContext
      : prompt.systemPrompt;
    if (fullSystemPrompt) {
      promptFilePath = join(tmpdir(), `snail-system-prompt-${randomUUID()}.txt`);
      writeFileSync(promptFilePath, fullSystemPrompt, "utf-8");
      args.push("--append-system-prompt-file", promptFilePath);
    }

    // Spawn process
    const proc = this.spawnProcess(
      "claude",
      args,
      { cwd: workspaceRoot, stdio: ["pipe", "pipe", "pipe"], detached: true, env: { ...process.env, ...options.contextEnv } }
    );

    const processController = manageInvocationProcess({
      proc,
      agentName: "ClaudeCode",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    let resultContent = "";
    let outputEventCount = 0;
    const stderrTracker = { text: "" };

    const closeDone = new Promise<void>((resolve) => {
      proc.on("close", (code, signal) => {
        processController.cleanup();
        if (promptFilePath) { try { unlinkSync(promptFilePath); } catch { /* non-fatal */ } }
        resolve();
      });
    });

    this.captureStderr(proc, stderrTracker);
    const outputDone = this.readOutput(proc, proc.stdout!, onEvent, (content) => {
      resultContent = content;
    }, options.contextWindow);

    // 发送 user message
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

    return { waitForStop: () => processController.waitForStop() };
  }

  private async readOutput(
    proc: ChildProcess,
    stdout: Readable,
    onEvent: (event: AgentEvent) => void,
    onResult: (content: string) => void,
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
        reject(new Error(`ClaudeCode stdout stream error: ${error.message}`));
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
    const transcript = renderStatelessTranscript(messages);
    const contentBlocks: Array<{ type: "text"; text: string }> = [];
    if (systemReminder) {
      contentBlocks.push({ type: "text", text: `<system-reminder>\n${systemReminder}\n</system-reminder>` });
    }
    contentBlocks.push({ type: "text", text: transcript });

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

/**
 * 从 AgentRequest 中提取统一的字段。
 * Stateless agent 始终使用 FirstCallRequest 的完整上下文。
 */
function resolveRequest(request: AgentRequest): {
  prompt: { systemPrompt: string; systemReminder: string; mcpContext: string };
  capabilities: { skills: any[]; mcpServers: any[] };
  security: SecuritySpec;
  messages: Message[];
  workspaceRoot: string;
} {
  if (request.kind === "first_call") {
    return {
      prompt: request.prompt,
      capabilities: request.capabilities,
      security: request.security,
      messages: request.messages,
      workspaceRoot: request.workspaceRoot,
    };
  }
  // ResumeRequest 对 stateless agent 无意义，但不阻塞——用空 prompt + 增量消息
  return {
    prompt: { systemPrompt: "", systemReminder: request.systemReminder, mcpContext: "" },
    capabilities: { skills: [], mcpServers: [] },
    security: { deny: [], allow: [] },
    messages: request.messages,
    workspaceRoot: request.workspaceRoot,
  };
}
