import { spawn, type ChildProcess } from "child_process";
import type {
  AgentInvocationResult,
  AgentEvent,
  AgentInvocationOptions,
  SnailRuntimeMessageInput,
  StatelessAgentInvoker,
  StatelessInvocationInput,
} from "./interface";
import { logger } from "../logger";
import { buildStatelessMessages } from "./prompt-mapper";
import { formatText } from "./log-preview";
import { renderStatelessTranscript } from "./stateless-runtime-adapter";
import type { GuardProfile } from "../shared/types";
import { ClaudeCodeBase, isOutputEvent } from "./claude-code-base";

export class ClaudeCodeAgent extends ClaudeCodeBase implements StatelessAgentInvoker {
  readonly name = "claude-code";
  readonly runtime = "claude-code-cli";

  constructor(spawnFn: typeof spawn = spawn) {
    super("ClaudeCode", spawnFn);
  }

  async invokeMessage(input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions): Promise<AgentInvocationResult> {
    const { contextEnv } = this.prepareInvocation(input);

    return this.invokeStateless(
      {
        systemPrompt: input.capability.systemPrompt,
        systemReminder: input.capability.systemReminder,
        messages: buildStatelessMessages(input),
      },
      onEvent,
      { ...options, contextEnv },
      input.workspaceRoot,
      input.capability.guardProfile,
    );
  }

  async invokeStateless(
    input: StatelessInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options: AgentInvocationOptions = {},
    cwd?: string,
    guardProfile?: GuardProfile,
  ): Promise<AgentInvocationResult> {
    const { systemPrompt, systemReminder } = input;

    const args = this.buildBaseArgs(options, guardProfile, cwd);
    args.push("--no-session-persistence");

    let promptFilePath: string | null = null;
    if (systemPrompt) {
      promptFilePath = this.writeSystemPromptFile(systemPrompt);
      args.push("--append-system-prompt-file", promptFilePath);
    }

    const { proc, processController } = this.spawnClaudeCodeProcess(args, options, cwd, options.contextEnv);

    let resultContent = "";
    let outputEventCount = 0;
    const stderrTracker = { text: "" };

    const closeDone = new Promise<void>((resolve) => {
      proc.on("close", (code, signal) => {
        processController.cleanup();
        this.cleanupPromptFile(promptFilePath);
        logger.debug("ClaudeCode process closed", { code, signal, stderrPreview: formatText(stderrTracker.text) });
        resolve();
      });
    });

    this.captureStderr(proc, stderrTracker);
    const outputDone = this.readOutput(proc, proc.stdout!, {
      onEvent: (event) => {
        if (isOutputEvent(event)) outputEventCount += 1;
        onEvent(event);
      },
      onResult: (content) => {
        resultContent = content;
      },
    }, options.contextWindow);

    this.sendUserMessage(proc, input, systemReminder, args, promptFilePath);

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

  private sendUserMessage(proc: ChildProcess, input: StatelessInvocationInput, systemReminder: string, args: string[], promptFilePath: string | null): void {
    const userContent = renderStatelessTranscript(input.messages);
    const contentBlocks: Array<{ type: "text"; text: string }> = [];
    if (systemReminder) {
      contentBlocks.push({ type: "text", text: `<system-reminder>\n${systemReminder}\n</system-reminder>` });
    }
    contentBlocks.push({ type: "text", text: userContent });

    logger.debug("ClaudeCode stateless invocation", {
      args: args.filter((a) => a !== promptFilePath),
      systemPromptSize: input.systemPrompt?.length ?? 0,
      systemReminderSize: systemReminder.length,
      transcriptSize: userContent.length,
    });

    this.writeStdin(proc, {
      type: "user",
      message: { role: "user", content: contentBlocks },
    });
  }
}
