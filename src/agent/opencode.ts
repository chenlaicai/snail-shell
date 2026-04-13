import { spawn } from "child_process";
import type {
  AgentEvent,
  AgentInvocationResult,
  AgentMessage,
  SnailRuntime,
  SnailRuntimeTurnInput,
  StatefulAgentInvoker,
  StatefulInvocationInput,
} from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages } from "./prompt-mapper";
import { logger } from "../logger";

interface OpenCodeStreamEvent {
  type?: string;
  sessionID?: string;
  part?: OpenCodePart;
  [key: string]: unknown;
}

interface OpenCodePart {
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  sessionID?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    error?: string;
  };
  [key: string]: unknown;
}

interface OpenCodeParseState {
  buffer: string;
  rawOutput: string[];
  textChunks: string[];
  finalText: string | null;
  sessionId: string | null;
}

export class OpenCodeAgent implements SnailRuntime, StatefulAgentInvoker {
  readonly name = "opencode";
  readonly runtime = "opencode-cli";
  private readonly model = "my-xcode/gpt-5.4";

  async invokeTurn(input: SnailRuntimeTurnInput, onEvent: (event: AgentEvent) => void): Promise<AgentInvocationResult> {
    // OpenCode is intentionally modeled as a stateful non-interactive runtime.
    // The conversation carries per-snail runtime sessions. On the first turn for this
    // snail we bootstrap from Snail Shell context; after that we only send the latest
    // user turn and trust OpenCode to manage this snail's session context itself.
    const sessionId = input.conversation.runtime_sessions[input.snail.name]?.sessionId ?? null;
    return this.invokeStateful(
      {
        sessionId,
        bootstrap: sessionId
          ? null
          : buildStatefulBootstrap(input),
        incrementalMessages: buildStatefulIncrementalMessages(input),
      },
      onEvent
    );
  }

  async invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void
  ): Promise<AgentInvocationResult> {
    // OpenCode is integrated using its native session model.
    // We let OpenCode manage ongoing context for a conversation-bound session.
    // On the first turn we bootstrap the session with system prompt and prior history.
    // On later turns we only pass the newest user message and continue with `--session`.
    // This is intentionally different from the Claude Code runtime: Snail Shell does
    // not try to re-send the entire history after a session exists.
    const prompt = buildPrompt(input);
    const args = buildArgs(this.model, input, prompt);

    logInvocationStart(this.model, input, prompt, args);
    const { exitCode, stderr, state } = await executeOpenCode(args, input.sessionId, onEvent);
    logProcessClosed(exitCode, stderr, state.sessionId);

    if (exitCode !== 0) {
      throw new Error(`opencode exited with code ${exitCode}: ${stderr || state.rawOutput.join("")}`);
    }

    const reply = finalizeOpenCodeReply(state);
    logInvocationResult(reply, state);
    onEvent({ type: "result", content: reply });
    return { content: reply, sessionId: state.sessionId };
  }
}

function createParseState(sessionId: string | null): OpenCodeParseState {
  return {
    buffer: "",
    rawOutput: [],
    textChunks: [],
    finalText: null,
    sessionId,
  };
}

function buildPrompt(input: StatefulInvocationInput): string {
  const parts: string[] = [];
  if (input.bootstrap) {
    // Bootstrap is only for session creation. Once OpenCode has a session ID, the
    // runtime should not reconstruct history again unless the product design changes.
    parts.push(`SYSTEM:\n${input.bootstrap.systemPrompt}`);
    parts.push(...input.bootstrap.messages.map((message) => formatMessage(message)));
  }
  parts.push(...input.incrementalMessages.map((message) => formatMessage(message)));
  return parts.join("\n\n");
}

function formatMessage(message: AgentMessage): string {
  return `${message.role.toUpperCase()}:\n${message.content}`;
}

function buildArgs(model: string, input: StatefulInvocationInput, prompt: string): string[] {
  const args = [
    "run",
    "--format",
    "json",
    "--dangerously-skip-permissions",
    "--model",
    model,
  ];

  if (input.sessionId) {
    args.push("--session", input.sessionId);
  }

  args.push(prompt);
  return args;
}

function logInvocationStart(model: string, input: StatefulInvocationInput, prompt: string, args: string[]): void {
  logger.info("OpenCode invokeStateful start", {
    model,
    sessionId: input.sessionId,
    hasBootstrap: Boolean(input.bootstrap),
    bootstrapMessageCount: input.bootstrap?.messages.length ?? 0,
    incrementalMessageCount: input.incrementalMessages.length,
    incrementalMessagePreview: previewText(input.incrementalMessages.map((message) => message.content).join("\n\n")),
    promptPreview: previewText(prompt),
    args: summarizeArgs(args),
  });
}

async function executeOpenCode(
  args: string[],
  sessionId: string | null,
  onEvent: (event: AgentEvent) => void
): Promise<{ exitCode: number | null; stderr: string; state: OpenCodeParseState }> {
  const proc = spawn("opencode", args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  const state = createParseState(sessionId);

  proc.stdout?.on("data", (chunk: Buffer) => {
    consumeOpenCodeOutput(state, chunk.toString(), onEvent);
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    logger.debug("OpenCode stderr", { chunk: previewText(text) });
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code));
  });

  flushOpenCodeOutput(state, onEvent);
  return { exitCode, stderr, state };
}

function logProcessClosed(exitCode: number | null, stderr: string, sessionId: string | null): void {
  logger.info("OpenCode process closed", {
    exitCode,
    sessionId,
    stderrPreview: previewText(stderr),
  });
}

function logInvocationResult(reply: string, state: OpenCodeParseState): void {
  logger.info("OpenCode invokeStateful result", {
    sessionId: state.sessionId,
    replyPreview: previewText(reply),
    textChunkCount: state.textChunks.length,
  });
}

export function consumeOpenCodeOutput(
  state: OpenCodeParseState,
  chunk: string,
  onEvent: (event: AgentEvent) => void
): void {
  state.rawOutput.push(chunk);
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    handleOpenCodeLine(state, line, onEvent);
  }
}

export function flushOpenCodeOutput(state: OpenCodeParseState, onEvent: (event: AgentEvent) => void): void {
  if (state.buffer.trim()) {
    handleOpenCodeLine(state, state.buffer, onEvent);
  }
  state.buffer = "";
}

export function finalizeOpenCodeReply(state: OpenCodeParseState): string {
  const reply = state.finalText ?? state.textChunks.join("");
  if (!reply.trim()) {
    throw new Error("opencode returned no reply content");
  }
  return reply;
}

function handleOpenCodeLine(
  state: OpenCodeParseState,
  line: string,
  onEvent: (event: AgentEvent) => void
): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let event: OpenCodeStreamEvent;
  try {
    event = JSON.parse(trimmed) as OpenCodeStreamEvent;
  } catch {
    return;
  }

  if (typeof event.sessionID === "string" && event.sessionID) {
    state.sessionId = event.sessionID;
    logger.debug("OpenCode session updated from event", { sessionId: state.sessionId, source: "event.sessionID" });
  }
  if (typeof event.part?.sessionID === "string" && event.part.sessionID) {
    state.sessionId = event.part.sessionID;
    logger.debug("OpenCode session updated from event", { sessionId: state.sessionId, source: "event.part.sessionID" });
  }

  const mappedEvents = mapOpenCodeEvent(event, state);
  for (const mappedEvent of mappedEvents) {
    onEvent(mappedEvent);
  }
}

function mapOpenCodeEvent(event: OpenCodeStreamEvent, state: OpenCodeParseState): AgentEvent[] {
  if (event.type === "text") {
    const text = typeof event.part?.text === "string" ? event.part.text : "";
    if (!text) {
      return [];
    }
    state.textChunks.push(text);
    state.finalText = state.textChunks.join("");
    logger.debug("OpenCode text event", { contentPreview: previewText(text) });
    return [{ type: "text", content: text }];
  }

  if (event.type === "tool_use") {
    return mapToolUseEvent(event);
  }

  if (event.type === "step_finish") {
    const error = extractToolError(event.part);
    logger.debug("OpenCode step_finish event", { hasError: Boolean(error) });
    return error ? [{ type: "error", error }] : [];
  }

  return [];
}

function mapToolUseEvent(event: OpenCodeStreamEvent): AgentEvent[] {
  const part = event.part;
  if (!part) {
    return [];
  }

  const input = isRecord(part.state?.input) ? part.state.input : {};
  const events: AgentEvent[] = [{
    type: "tool_use",
    id: typeof part.callID === "string" ? part.callID : "tool-use",
    name: typeof part.tool === "string" ? part.tool : "tool",
    input,
  }];

  logger.debug("OpenCode tool_use event", {
    toolName: typeof part.tool === "string" ? part.tool : "tool",
    toolInputPreview: previewText(JSON.stringify(input)),
  });

  const error = extractToolError(part);
  if (error) {
    events.push({ type: "error", error });
  }

  return events;
}

function extractToolError(part: OpenCodePart | undefined): string | null {
  if (!part?.state || part.state.status !== "error") {
    return null;
  }
  return typeof part.state.error === "string" && part.state.error
    ? part.state.error
    : "opencode tool call failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function previewText(text: string, maxLength = 500): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function summarizeArgs(args: string[]): string[] {
  return args.map((arg, index) => (index === args.length - 1 ? previewText(arg, 200) : arg));
}
