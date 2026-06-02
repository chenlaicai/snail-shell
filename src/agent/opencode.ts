import type {
  AgentEvent,
  AgentInvocationOptions,
  AgentInvocationResult,
  SnailRuntime,
  SnailRuntimeMessageInput,
  StatefulAgentInvoker,
  StatefulInvocationInput,
} from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages } from "./prompt-mapper";
import { StatefulCLIAgent, type CLIConfig, type ParseState, type StreamEvent } from "./stateful-cli-agent";
import { logger } from "../logger";
import { ensureMcpServers } from "./mcp-config";
import { writeOpenCodeGuardConfig } from "./guard-config";
import { ensureSkillSymlinks } from "./skill-symlinks";

// OpenCode 安全机制：移除 --dangerously-skip-permissions 恢复默认权限模式。
// OpenCode 项目级配置：<wsRoot>/opencode.json（CWD auto-discovery，以 workspaceRoot 为 CWD 启动）。
// 全局配置：~/.config/opencode/opencode.jsonc（provider、permission 等）。
// MCP 接入：ensureMcpServers 写入 <wsRoot>/opencode.json 的 mcp 字段，
// OpenCode 以 workspaceRoot 为 CWD 启动，从 CWD 自动发现 opencode.json。

const OPENCODE_ENV_KEYS = [
  "OPENCODE",
  "OPENCODE_CLIENT",
  "OPENCODE_EXPERIMENTAL_FILEWATCHER",
  "OPENCODE_EXPERIMENTAL_ICON_DISCOVERY",
  "OPENCODE_PID",
  "OPENCODE_PROCESS_ROLE",
  "OPENCODE_RUN_ID",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
] as const;

export class OpenCodeAgent extends StatefulCLIAgent implements SnailRuntime, StatefulAgentInvoker {
  readonly name = "opencode";
  readonly runtime = "opencode-cli";
  private static readonly DEFAULT_MODEL = "my-geek/gpt-5.5";

  private openCodeCapWarned = false;

  protected getAgentName(): string {
    return "OpenCode";
  }

  protected getCLIConfig(model?: string, contextWindow?: number | null): CLIConfig {
    const resolvedModel = model ?? OpenCodeAgent.DEFAULT_MODEL;
    return {
      command: "opencode",
      model: resolvedModel,
      contextWindow,
      buildEnv: () => {
        const env = { ...process.env };
        for (const key of OPENCODE_ENV_KEYS) {
          delete env[key];
        }
        return env;
      },
      buildArgs: (input: StatefulInvocationInput, prompt: string) => {
        // OpenCode 无内置 sandbox（官方建议 Docker 容器运行），
        // 项目级配置：<wsRoot>/opencode.json（CWD auto-discovery）。
        // 安全机制：移除 --dangerously-skip-permissions 恢复默认权限模式。
        const args = [
          "run",
          "--format",
          "json",
          "--model",
          resolvedModel,
        ];

        if (input.sessionId) {
          args.push("--session", input.sessionId);
        }

        args.push(prompt);
        return args;
      },
    };
  }

  async invokeMessage(input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions): Promise<AgentInvocationResult> {
    // 将 ACS GuardProfile 翻译为 OpenCode permission 配置（全局配置 ~/.config/opencode/opencode.jsonc）
    // 配置写入是同步的，在 OpenCode 进程启动前完成。OpenCode 在启动时读取配置，因此配置必须在进程启动前写入。
    // 注意：由于 OpenCode 使用全局配置，当多个工作区同时运行时，后写入的配置会覆盖先写入的配置。
    // 这是 OpenCode 架构的固有限制，当前通过每次 invokeMessage 时重新写入配置来缓解。
    writeOpenCodeGuardConfig(input.capability.guardProfile);

    // OpenCode 能力缺口告警（仅首次）：
    // database/filesystem/git/network 全部四个 GuardProfile domain 均无法在 OpenCode 参数级执行；
    // 安全仅由默认权限模式（移除 --dangerously-skip-permissions）提供。
    // OpenCode 无 per-workspace 配置入口、无 OS sandbox、无 PreToolUse hooks。
    if (!this.openCodeCapWarned) {
      this.openCodeCapWarned = true;
      logger.warn("OpenCode GuardProfile 全部 domain（database/filesystem/git/network）均无参数级拦截：无 per-workspace 配置、无 sandbox、无 PreToolUse hooks");
    }

    // 消费 ACP mcpServers：写入 <wsRoot>/opencode.json 的 mcp 字段
    // OpenCode 以 workspaceRoot 作为 CWD 启动，从 CWD 自动发现 opencode.json
    ensureMcpServers(input.capability.mcpServers, input.workspaceRoot, "opencode");

    // 将 ACS skills 暴露为 OpenCode 原生 skill 目录（.claude/skills/ + .agents/skills/）
    // OpenCode 同时扫描两个目录，agent 通过 skill tool 调用
    ensureSkillSymlinks(input.workspaceRoot, input.capability.skills);

    const sessionId = input.externalSessionId;
    let bootstrap = sessionId ? null : buildStatefulBootstrap(input);
    if (bootstrap) {
      bootstrap = {
        ...bootstrap,
        systemPrompt: input.capability.systemPrompt,
      };
    }
    return this.invokeStateful(
      {
        sessionId,
        bootstrap,
        incrementalMessages: buildStatefulIncrementalMessages(input),
        systemReminder: input.capability.systemReminder,
      },
      onEvent,
      options,
      input.workspaceRoot,
    );
  }

  // OpenCode has sessionID in both top-level and part-level, override to handle both
  protected extractSessionId(state: ParseState, event: StreamEvent): void {
    if (typeof event.sessionID === "string" && event.sessionID) {
      state.sessionId = event.sessionID;
    }
    if (typeof event.part?.sessionID === "string" && event.part.sessionID) {
      state.sessionId = event.part.sessionID;
    }
  }
}

// Export parser functions for testing
export function consumeOpenCodeOutput(
  state: ParseState,
  chunk: string,
  onEvent: (event: AgentEvent) => void
): void {
  const agent = new OpenCodeAgent();
  agent.consumeOutput(state, chunk, onEvent);
}

export function flushOpenCodeOutput(state: ParseState, onEvent: (event: AgentEvent) => void): void {
  const agent = new OpenCodeAgent();
  agent.flushOutput(state, onEvent);
}

export function collectOpenCodeText(state: ParseState): string {
  const agent = new OpenCodeAgent();
  agent.assertOutputEvents(state);
  return state.finalText ?? state.textChunks.join("");
}

export function invokeOpenCodeForTest(input: StatefulInvocationInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions): Promise<AgentInvocationResult> {
  return new OpenCodeAgent().invokeStateful(input, onEvent, options);
}
