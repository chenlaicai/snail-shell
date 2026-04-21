import { spawn } from "child_process";
import type {
  AgentEvent,
  AgentInvocationResult,
  AgentMessage,
  SnailRuntime,
  SnailRuntimeMessageInput,
  StatefulAgentInvoker,
  StatefulInvocationInput,
} from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages } from "./prompt-mapper";
import { logger } from "../logger";

// Codex JSON event types observed from actual CLI output:
// - {"type":"thread.started","thread_id":"..."}
// - {"type":"turn.started"}
// - {"type":"turn.completed","message":{"role":"assistant","content":[...]}}
// - {"type":"turn.failed","error":{"message":"..."}}
// - {"type":"error","message":"..."}

interface CodexEvent {
  type: string;
  thread_id?: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  };
  error?: {
    message: string;
  };
  [key: string]: unknown;
}

export interface CodexParseState {
  buffer: string;
  rawOutput: string[];
  textChunks: string[];
  threadId: string | null;
  completed: boolean;
  failed: boolean;
}

export class CodexAgent implements SnailRuntime, StatefulAgentInvoker {
  readonly name = "codex";
  readonly runtime = "codex-cli" as const;
  private readonly model = "claude-opus-4";

  async invokeMessage(input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void): Promise<AgentInvocationResult> {
    // Codex uses thread-based sessions (thread_id) rather than sessionId.
    // On first message we bootstrap with full context; on subsequent messages we resume the thread.
    const threadId = input.conversation.runtime_sessions[input.snail.name]?.sessionId ?? null;
    return this.invokeStateful(
      {
        sessionId: threadId,
        bootstrap: threadId ? null : buildStatefulBootstrap(input),
        incrementalMessages: buildStatefulIncrementalMessages(input),
      },
      onEvent
    );
  }

  async invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void
  ): Promise<AgentInvocationResult> {
    const prompt = buildPrompt(input);
    const args = buildArgs(this.model, input);

    const { exitCode, stderr, state } = await executeCodex(args, input.sessionId, prompt, onEvent);

    if (state.failed || exitCode !== 0) {
      const errorMsg = stderr || state.rawOutput.join("");
      throw new Error(`codex exec failed (exit ${exitCode}): ${errorMsg}`);
    }

    const reply = finalizeCodexReply(state);
    return { content: reply, sessionId: state.threadId };
  }
}

function createParseState(threadId: string | null): CodexParseState {
  return {
    buffer: "",
    rawOutput: [],
    textChunks: [],
    threadId,
    completed: false,
    failed: false,
  };
}

function buildPrompt(input: StatefulInvocationInput): string {
  const parts: string[] = [];
  if (input.bootstrap) {
    parts.push(`SYSTEM:\n${input.bootstrap.systemPrompt}`);
    parts.push(...input.bootstrap.messages.map((message) => formatMessage(message)));
  }
  parts.push(...input.incrementalMessages.map((message) => formatMessage(message)));
  return parts.join("\n\n");
}

function formatMessage(message: AgentMessage): string {
  return `${message.role.toUpperCase()}:\n${message.content}`;
}

export function buildArgs(model: string, input: StatefulInvocationInput): string[] {
  // Codex CLI actual command structure:
  // - New session: codex exec --json --model <model> --dangerously-bypass-approvals-and-sandbox -
  // - Resume session: codex exec resume --session <thread_id> --json --dangerously-bypass-approvals-and-sandbox -
  // The "-" argument explicitly tells Codex to read prompt from stdin
  //
  // IMPORTANT: Do NOT use --ephemeral flag, as it prevents session persistence to disk,
  // making resume impossible. Both paths must include --dangerously-bypass-approvals-and-sandbox
  // to maintain non-interactive execution contract.

  if (input.sessionId) {
    // Resume existing thread
    return [
      "exec",
      "resume",
      "--session",
      input.sessionId,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-",
    ];
  } else {
    // Start new persistent thread
    return [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      model,
      "-",
    ];
  }
}

async function executeCodex(
  args: string[],
  threadId: string | null,
  prompt: string,
  onEvent: (event: AgentEvent) => void
): Promise<{ exitCode: number | null; stderr: string; state: CodexParseState }> {
  const proc = spawn("codex", args, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Send prompt via stdin
  if (proc.stdin) {
    proc.stdin.write(prompt);
    proc.stdin.end();
  }

  let stderr = "";
  const state = createParseState(threadId);

  proc.stdout?.on("data", (chunk: Buffer) => {
    consumeCodexOutput(state, chunk.toString(), onEvent);
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    logger.debug("Codex stderr", { chunk: text });
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code));
  });

  flushCodexOutput(state, onEvent);
  return { exitCode, stderr, state };
}

export function consumeCodexOutput(
  state: CodexParseState,
  chunk: string,
  onEvent: (event: AgentEvent) => void
): void {
  state.rawOutput.push(chunk);
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    handleCodexLine(state, line, onEvent);
  }
}

export function flushCodexOutput(state: CodexParseState, onEvent: (event: AgentEvent) => void): void {
  if (state.buffer.trim()) {
    handleCodexLine(state, state.buffer, onEvent);
  }
  state.buffer = "";
}

export function finalizeCodexReply(state: CodexParseState): string {
  const reply = state.textChunks.join("");
  if (!reply.trim()) {
    throw new Error("codex returned no reply content");
  }
  return reply;
}

function handleCodexLine(
  state: CodexParseState,
  line: string,
  onEvent: (event: AgentEvent) => void
): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let event: CodexEvent;
  try {
    event = JSON.parse(trimmed) as CodexEvent;
  } catch {
    // Not JSON, ignore (could be stderr mixed in)
    return;
  }

  processCodexEvent(event, state, onEvent);
}

function processCodexEvent(
  event: CodexEvent,
  state: CodexParseState,
  onEvent: (event: AgentEvent) => void
): void {
  // Extract thread_id from thread.started event
  if (event.type === "thread.started" && event.thread_id) {
    state.threadId = event.thread_id;
    logger.debug("Codex thread started", { threadId: state.threadId });
    return;
  }

  // Handle turn completion
  if (event.type === "turn.completed" && event.message) {
    state.completed = true;
    extractTextFromMessage(event.message, state, onEvent);
    return;
  }

  // Handle turn failure
  if (event.type === "turn.failed") {
    handleTurnFailure(event, state, onEvent);
    return;
  }

  // Handle error events
  if (event.type === "error" && typeof event.message === "string") {
    logger.warn("Codex error event", { message: event.message });
    onEvent({ type: "error_detail", error: event.message });
  }
}

function handleTurnFailure(
  event: CodexEvent,
  state: CodexParseState,
  onEvent: (event: AgentEvent) => void
): void {
  state.failed = true;
  const errorMsg = event.error?.message || "Turn failed";
  logger.error("Codex turn failed", { error: errorMsg });
  onEvent({ type: "error_detail", error: errorMsg });
  onEvent({ type: "terminal_failure", error: errorMsg });
}

function extractTextFromMessage(
  message: { role: string; content: Array<{ type: string; text?: string; [key: string]: unknown }> },
  state: CodexParseState,
  onEvent: (event: AgentEvent) => void
): void {
  for (const block of message.content) {
    if (block.type === "text" && block.text) {
      state.textChunks.push(block.text);
      onEvent({ type: "output_text_delta", text: block.text });
    }
  }
}
