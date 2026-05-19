import { promisify } from "util";
import { exec } from "child_process";
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
import { StatefulCLIAgent, type CLIConfig, type ParseState } from "./stateful-cli-agent";
import { logger } from "../logger";

const execAsync = promisify(exec);

export class GeminiAgent extends StatefulCLIAgent implements SnailRuntime, StatefulAgentInvoker {
  readonly name = "gemini";
  readonly runtime = "gemini-cli";
  private cliAvailable: boolean | null = null;

  protected getAgentName(): string {
    return "Gemini";
  }

  protected getCLIConfig(model?: string, contextWindow?: number | null): CLIConfig {
    return {
      command: "gemini",
      contextWindow,
      buildArgs: (input: StatefulInvocationInput, prompt: string) => {
        const args = [
          "-p",
          prompt,
          "--output-format",
          "stream-json",
          "--approval-mode",
          "yolo",
        ];

        if (model) {
          args.push("--model", model);
        }

        if (input.sessionId) {
          args.push("--resume", input.sessionId);
        }

        return args;
      },
      timeoutMs: 30 * 60 * 1000, // 30 minutes
    };
  }

  async checkCLI(): Promise<boolean> {
    if (this.cliAvailable !== null) {
      return this.cliAvailable;
    }

    try {
      await execAsync("which gemini");
      this.cliAvailable = true;
      logger.info("Gemini CLI found");
      return true;
    } catch {
      this.cliAvailable = false;
      logger.warn("Gemini CLI not found in PATH. Agent will not be available.");
      return false;
    }
  }

  async invokeMessage(input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions): Promise<AgentInvocationResult> {
    if (this.cliAvailable === false) {
      throw new Error("Gemini CLI not found. Please install it and ensure 'gemini' is in your PATH.");
    }

    const sessionId = input.conversation.runtime_sessions[input.role.name]?.sessionId ?? null;
    return this.invokeStateful(
      {
        sessionId,
        bootstrap: sessionId ? null : buildStatefulBootstrap(input),
        incrementalMessages: buildStatefulIncrementalMessages(input),
      },
      onEvent,
      options
    );
  }
}

// Export parser functions for testing
export function consumeGeminiOutput(
  state: ParseState,
  chunk: string,
  onEvent: (event: AgentEvent) => void
): void {
  const agent = new GeminiAgent();
  agent.consumeOutput(state, chunk, onEvent);
}

export function flushGeminiOutput(state: ParseState, onEvent: (event: AgentEvent) => void): void {
  const agent = new GeminiAgent();
  agent.flushOutput(state, onEvent);
}

export function collectGeminiText(state: ParseState): string {
  const agent = new GeminiAgent();
  agent.assertOutputEvents(state);
  return state.finalText ?? state.textChunks.join("");
}
