import type {
  AgentEvent,
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
  private readonly model = "my-geek/gpt-5.5";

  protected getAgentName(): string {
    return "OpenCode";
  }

  protected getCLIConfig(): CLIConfig {
    return {
      command: "opencode",
      buildEnv: () => {
        const env = { ...process.env };
        for (const key of OPENCODE_ENV_KEYS) {
          delete env[key];
        }
        return env;
      },
      buildArgs: (input: StatefulInvocationInput, prompt: string) => {
        const args = [
          "run",
          "--format",
          "json",
          "--dangerously-skip-permissions",
          "--model",
          this.model,
        ];

        if (input.sessionId) {
          args.push("--session", input.sessionId);
        }

        args.push(prompt);
        return args;
      },
    };
  }

  async invokeMessage(input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void): Promise<AgentInvocationResult> {
    const sessionId = input.conversation.runtime_sessions[input.snail.name]?.sessionId ?? null;
    return this.invokeStateful(
      {
        sessionId,
        bootstrap: sessionId ? null : buildStatefulBootstrap(input),
        incrementalMessages: buildStatefulIncrementalMessages(input),
      },
      onEvent
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
