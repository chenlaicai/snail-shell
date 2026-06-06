import { spawn, type ChildProcess } from "child_process";
import type {
  AgentEvent,
  AgentInvocationOptions,
  AgentInvocationResult,
  SnailRuntimeMessageInput,
  StatefulAgentInvoker,
  StatefulInvocationInput,
} from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages } from "./prompt-mapper";
import { logger } from "../logger";
import { formatText } from "./log-preview";
import type { GuardProfile } from "../persistence/guard-profile-store";
import { ClaudeCodeBase, isOutputEvent } from "./claude-code-base";

/**
 * Claude Code 有状态 Agent
 *
 * 支持会话恢复（resume）的 Claude Code CLI 封装。
 * 与无状态的 ClaudeCodeAgent 不同，此 agent 会维护会话状态，
 * 允许跨多轮对话保持上下文。
 *
 * 实现特点：
 * - 继承 ClaudeCodeBase，复用 stdin/stdout JSON stream 协议
 * - 使用 --resume <sessionId> 恢复会话
 * - 从 stdout 消息中提取 session_id
 * - 系统提示词通过 --append-system-prompt-file 注入
 */
export class ClaudeCodeStatefulAgent extends ClaudeCodeBase implements StatefulAgentInvoker {
  readonly name = "claude-code-stateful";
  readonly runtime = "claude-code-stateful-cli";

  constructor(spawnFn: typeof spawn = spawn) {
    super("ClaudeCodeStateful", spawnFn);
  }

  /** 从 stdout 消息中提取 session ID（stateful 特有）。 */
  protected override extractSessionId(msg: any): string | null {
    if (typeof msg.session_id === "string" && msg.session_id) return msg.session_id;
    if (typeof msg.sessionID === "string" && msg.sessionID) return msg.sessionID;
    return null;
  }

  async invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions,
  ): Promise<AgentInvocationResult> {
    const sessionId = input.externalSessionId;
    let bootstrap = sessionId ? null : buildStatefulBootstrap(input);
    if (bootstrap) {
      bootstrap = { ...bootstrap, systemPrompt: input.capability.systemPrompt };
    }

    const { contextEnv } = this.prepareInvocation(input);

    return this.invokeStateful(
      {
        sessionId,
        bootstrap,
        incrementalMessages: buildStatefulIncrementalMessages(input),
        systemReminder: input.capability.systemReminder,
      },
      onEvent,
      { ...options, contextEnv },
      input.workspaceRoot,
      input.capability.guardProfile,
    );
  }

  async invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options: AgentInvocationOptions = {},
    cwd?: string,
    guardProfile?: GuardProfile,
  ): Promise<AgentInvocationResult> {
    let promptFilePath: string | null = null;
    if (input.bootstrap?.systemPrompt) {
      promptFilePath = this.writeSystemPromptFile(input.bootstrap.systemPrompt);
    }

    const args = this.buildArgs(input, options, promptFilePath, guardProfile, cwd);
    const { proc, processController } = this.spawnClaudeCodeProcess(args, options, cwd, options.contextEnv);
    const state = { resultContent: "", outputEventCount: 0, stderr: "", sessionId: input.sessionId };

    const closeDone = new Promise<void>((resolve) => {
      proc.on("close", (code, signal) => {
        processController.cleanup();
        this.cleanupPromptFile(promptFilePath);
        logger.debug("ClaudeCodeStateful process closed", { code, signal, stderrPreview: formatText(state.stderr) });
        resolve();
      });
    });

    proc.stderr?.on("data", (data: Buffer) => {
      state.stderr += data.toString();
      logger.debug("ClaudeCodeStateful stderr", { chunk: formatText(data.toString()) });
    });

    const outputDone = this.readOutput(proc, proc.stdout!, {
      onEvent: (event) => {
        if (isOutputEvent(event)) state.outputEventCount += 1;
        onEvent(event);
      },
      onResult: (content) => {
        state.resultContent = content;
      },
      onSessionId: (extractedSessionId) => {
        state.sessionId = extractedSessionId;
      },
    }, options.contextWindow);

    this.sendUserInput(proc, input, args);

    await outputDone;
    proc.stdin?.end();
    await closeDone;
    await processController.throwIfStopped();

    if (proc.exitCode !== 0 && !state.resultContent) {
      throw new Error(`claude code stateful exited with code ${proc.exitCode}: ${state.stderr}`);
    }

    if (state.outputEventCount === 0) {
      const maxLen = 500;
      const truncated = state.stderr.length > maxLen ? state.stderr.slice(0, maxLen) + "..." : state.stderr;
      const diagnosticInfo = state.stderr ? ` (stderr: ${truncated})` : "";
      throw new Error(`claude code stateful returned no output events${diagnosticInfo}`);
    }

    return { sessionId: state.sessionId, waitForStop: () => processController.waitForStop() };
  }

  private buildArgs(input: StatefulInvocationInput, options: AgentInvocationOptions, promptFilePath: string | null, guardProfile?: GuardProfile, workspaceRoot?: string): string[] {
    const args = this.buildBaseArgs(options, guardProfile, workspaceRoot);

    if (input.sessionId) {
      args.push("--resume", input.sessionId);
    }

    if (promptFilePath) {
      args.push("--append-system-prompt-file", promptFilePath);
    }

    return args;
  }

  private sendUserInput(proc: ChildProcess, input: StatefulInvocationInput, args: string[]): void {
    const parts: string[] = [];

    if (input.systemReminder) {
      parts.push(`<system-reminder>\n${input.systemReminder}\n</system-reminder>`);
    }

    if (input.bootstrap) {
      for (const message of input.bootstrap.messages) {
        parts.push(message.content);
      }
    }

    for (const message of input.incrementalMessages) {
      parts.push(message.content);
    }

    const userContent = parts.join("\n\n");

    logger.debug("ClaudeCodeStateful invocation", {
      args,
      sessionId: input.sessionId,
      hasBootstrap: !!input.bootstrap,
      incrementalMessageCount: input.incrementalMessages.length,
      transcriptSize: userContent.length,
    });

    this.writeStdin(proc, {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: userContent }] },
    });
  }
}
