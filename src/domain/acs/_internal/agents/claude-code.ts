import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Readable } from "stream";
import type { AgentRuntimePort } from "../../port";
import type { FirstCallRequest, ResumeRequest, AgentEvent, InvokeResult, InvokeOptions, SecuritySpec, Message } from "../../model";
import { manageInvocationProcess } from "../utils/managed-process";
import { renderStatelessTranscript } from "../utils/stateless-runtime-adapter";
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
    return this.invoke(request.prompt, request.capabilities, request.security, request.messages, request.workspaceRoot, onEvent, options);
  }

  async invokeResume(
    request: ResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    // Stateless agent 不支持 resume，用空 prompt + 增量消息
    const prompt = { systemPrompt: "", systemReminder: request.systemReminder, mcpContext: "" };
    const capabilities = { skills: [], mcpServers: [] };
    const security: SecuritySpec = { deny: [], allow: [] };
    return this.invoke(prompt, capabilities, security, request.messages, request.workspaceRoot, onEvent, options);
  }

  private async invoke(
    prompt: { systemPrompt: string; systemReminder: string; mcpContext: string },
    capabilities: { skills: any[]; mcpServers: any[] },
    security: SecuritySpec,
    messages: Message[],
    workspaceRoot: string,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions,
  ): Promise<InvokeResult> {
    // 注入 capabilities
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

    // 管理进程生命周期
    return manageInvocationProcess(proc, {
      onEvent,
      signal: options.signal,
      timeoutMs: options.invocationTimeoutMs,
      onCleanup: () => {
        if (promptFilePath) {
          try { unlinkSync(promptFilePath); } catch {}
        }
      },
      parseOutput: (data: Buffer) => {
        // 解析 Claude Code 的 stream-json 输出
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.type === "assistant") {
              // 文本输出
              const textContent = event.content?.find((c: any) => c.type === "text");
              if (textContent) {
                onEvent({
                  type: "message_event",
                  event: {
                    kind: "text",
                    payload: { text: textContent.text, mentions: [] },
                    source: { runtime_event_type: "assistant", runtime_message_id: event.id, runtime_call_id: null },
                  },
                });
              }
              // 工具调用
              const toolUse = event.content?.find((c: any) => c.type === "tool_use");
              if (toolUse) {
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
              // 运行时使用量
              if (event.usage) {
                onEvent(buildRuntimeUsageSignal(usageDetailFromClaudeResult(event.usage), "result"));
              }
            }
          } catch {}
        }
      },
    });
  }
}

export const agent = new ClaudeCodeAgent();
