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
        // 权限由 opencode.json 控制。不再使用 --dangerously-skip-permissions
        // 跳过权限系统。Snail Shell 通过 ACP GuardProfile 控制策略。
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
      },
      onEvent,
      options
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
