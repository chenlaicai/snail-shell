import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { AgentRuntimePort } from "../../port";
import type { FirstCallRequest, ResumeRequest, AgentEvent, InvokeResult, InvokeOptions, GuardProfile, Message } from "../../model";
import { manageInvocationProcess } from "../utils/managed-process";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "../utils/runtime-usage";
import { ensureMcpServers } from "../utils/mcp-config";
import { ensureSkillSymlinks } from "../utils/skill-symlinks";

/**
 * Claude Code stateless 适配器。
 *
 * 每次调用都重建完整上下文窗口。
 * 通过 --append-system-prompt-file 注入 system prompt，
 * 通过 stdin JSON 传递对话历史，
 * 通过 stdout stream-json 接收事件。
 */
export class ClaudeCodeAgent implements AgentRuntimePort {
  readonly name = "claude-code";

  constructor(
    private readonly spawnProcess: typeof spawn = spawn,
  ) {}

  async invokeFirstCall(
    request: FirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    // 注入 capabilities
    ensureMcpServers(request.capabilities.mcpServers, request.workspacePath, "claude");
    ensureSkillSymlinks(request.workspacePath, request.capabilities.skills);

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

    // Guard deny → --disallowedTools
    if (request.guard_profile.deny.length > 0) {
      args.push("--disallowedTools", ...request.guard_profile.deny);
    }

    // MCP 配置
    args.push("--mcp-config", join(request.workspacePath, ".claude", "mcp.json"));

    // System prompt 文件注入
    let promptFilePath: string | null = null;
    if (request.prompt.systemPrompt) {
      promptFilePath = join(tmpdir(), `snail-system-prompt-${randomUUID()}.txt`);
      writeFileSync(promptFilePath, request.prompt.systemPrompt, "utf-8");
      args.push("--append-system-prompt-file", promptFilePath);
    }

    // Spawn process
    const proc = this.spawnProcess(
      "claude",
      args,
      { cwd: request.workspacePath, stdio: ["pipe", "pipe", "pipe"], detached: true, env: { ...process.env, ...options.contextEnv } }
    );

    // 管理进程生命周期
    const processController = manageInvocationProcess({
      proc,
      agentName: "ClaudeCode",
      signal: options.signal,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30 * 60 * 1000,
    });

    // 读取 stdout 事件
    let outputEventCount = 0;
    const stdoutDone = this.readOutput(proc, onEvent, () => { outputEventCount++; }, options.contextWindow);

    // 写入 stdin 消息
    this.writeMessages(proc, request.messages, request.prompt.systemReminder);

    // 等待完成
    await stdoutDone;
    proc.stdin?.end();
    await new Promise<void>(resolve => proc.on("close", () => {
      processController.cleanup();
      if (promptFilePath) { try { unlinkSync(promptFilePath); } catch {} }
      resolve();
    }));
    await processController.throwIfStopped();

    if (outputEventCount === 0) {
      throw new Error("claude code returned no output events");
    }

    return { waitForStop: () => processController.waitForStop() };
  }

  async invokeResume(
    _request: ResumeRequest,
    _onEvent: (event: AgentEvent) => void,
    _options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    throw new Error("claude-code is stateless and does not support invokeResume. Use invokeFirstCall instead.");
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private async readOutput(
    proc: ChildProcess,
    onEvent: (event: AgentEvent) => void,
    onOutputEvent: () => void,
    contextWindow?: number | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = "";

      proc.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "assistant") {
              const textContent = event.content?.find((c: any) => c.type === "text");
              if (textContent) {
                onOutputEvent();
                onEvent({
                  type: "message_event",
                  event: {
                    kind: "text",
                    payload: { text: textContent.text, mentions: [] },
                    source: { runtime_event_type: "assistant", runtime_message_id: event.id, runtime_call_id: null },
                  },
                });
              }
              const toolUse = event.content?.find((c: any) => c.type === "tool_use");
              if (toolUse) {
                onOutputEvent();
                onEvent({
                  type: "message_event",
                  event: {
                    kind: "tool_call",
                    payload: { tool_name: toolUse.name, call_id: toolUse.id, input: toolUse.input, title: null },
                    source: { runtime_event_type: "tool_use", runtime_message_id: event.id, runtime_call_id: toolUse.id },
                  },
                });
              }
            } else if (event.type === "result") {
              if (event.usage) {
                onEvent(buildRuntimeUsageSignal(usageDetailFromClaudeResult(event.usage, contextWindow), "result"));
              }
              if (event.is_error) {
                const rawResult = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
                onEvent({
                  type: "message_event",
                  event: { kind: "message_failure", payload: { error: rawResult }, source: { runtime_event_type: "result", runtime_message_id: null } },
                });
              }
            }
          } catch {}
        }
      });

      proc.stdout?.on("error", (error) => {
        reject(new Error(`ClaudeCode stdout stream error: ${error.message}`));
      });

      proc.stdout?.on("end", () => resolve());
    });
  }

  private writeMessages(proc: ChildProcess, messages: Message[], systemReminder: string): void {
    const contentBlocks: Array<{ type: "text"; text: string }> = [];

    // system-reminder 注入到 user message 首位
    if (systemReminder) {
      contentBlocks.push({ type: "text", text: `<system-reminder>\n${systemReminder}\n</system-reminder>` });
    }

    // 消息内容
    for (const msg of messages) {
      const speaker = msg.speaker ? `[${msg.speaker}]: ` : "";
      contentBlocks.push({ type: "text", text: `${speaker}${msg.content}` });
    }

    this.writeStdin(proc, {
      type: "user",
      message: { role: "user", content: contentBlocks },
    });
  }

  private writeStdin(proc: ChildProcess, data: unknown): void {
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(JSON.stringify(data) + "\n");
    }
  }
}

export const agent = new ClaudeCodeAgent();
