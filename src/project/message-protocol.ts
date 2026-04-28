import type { AgentEvent, AgentMessageStatus, SnailRuntimeMessageInput } from "../agent/interface";
import type { CreateMessageEventInput, MessageEvent, MessageRuntime, MessageStatus, SnailName } from "../persistence/store";
import type { SnailDefinition } from "../snails";
import { logAgentOutput } from "../agent/message-flow-logger";
import { summarizeRuntimeError } from "../agent/runtime-error";
import { getInputContent } from "./message-events";

export interface MessageProtocolDeps {
  emitAgentEvent: (conversationId: string, event: Record<string, unknown>) => void;
  updateConversationRuntimeSessionId: (conversationId: string, snailName: SnailName, sessionId: string | null) => void;
  store: {
    addMessage: (input: { conversationId: string; fromSnail: SnailName; toSnails: SnailName[]; role: "assistant"; contextCutoffAt: string; runtime: MessageRuntime; status: "streaming" }) => { id: number };
    addMessageEvent: (messageId: number, event: CreateMessageEventInput) => MessageEvent;
    addMessageEvents: (messageId: number, events: CreateMessageEventInput[]) => MessageEvent[];
    completeMessageWithEvent: (messageId: number, event: CreateMessageEventInput, status: Exclude<MessageStatus, "streaming">) => MessageEvent;
    getMessageEvents: (messageId: number) => MessageEvent[];
  };
}

export interface MessageLifecycleFinalization {
  status: AgentMessageStatus;
  finalRole: "assistant" | "system";
  errorText?: string | null;
}

interface StreamingSession {
  assistantMessageId: number;
  outputSequence: number;
  rawReplyContent: string | null;
  lastObservedErrorText: string | null;
  terminalFailure: string | null;
  messageEnded: boolean;
}

export interface StreamingContext {
  deps: MessageProtocolDeps;
  session: StreamingSession;
  conversationId: string;
  activeSnail: SnailDefinition;
  contextCutoffAt: string;
}

export function normalizeRuntime(runtime: string | null | undefined): MessageRuntime {
  if (runtime === "claude-code-cli" || runtime === "claude") return "claude";
  if (runtime === "opencode-cli" || runtime === "opencode") return "opencode";
  if (runtime === "codex-cli" || runtime === "codex") return "codex";
  if (runtime === "system") return "system";
  return "unknown";
}

export function createStreamingContext(input: { deps: MessageProtocolDeps; conversationId: string; activeSnail: SnailDefinition; contextCutoffAt: string }): StreamingContext {
  const runtime = normalizeRuntime(input.activeSnail.runtime);
  const message = input.deps.store.addMessage({
    conversationId: input.conversationId,
    fromSnail: input.activeSnail.name,
    toSnails: [],
    role: "assistant",
    contextCutoffAt: input.contextCutoffAt,
    runtime,
    status: "streaming",
  });
  input.deps.emitAgentEvent(input.conversationId, { type: "message_started", message_id: message.id, status: "streaming", snail_name: input.activeSnail.name, role: "assistant" });
  const startEvent = input.deps.store.addMessageEvent(message.id, { kind: "start", payload: { role: "assistant", snail_name: input.activeSnail.name, runtime }, source: { runtime_name: runtime } });
  emitEventAppended({ deps: input.deps, conversationId: input.conversationId, snailName: input.activeSnail.name, messageId: message.id, event: startEvent });
  return {
    deps: input.deps,
    conversationId: input.conversationId,
    activeSnail: input.activeSnail,
    contextCutoffAt: input.contextCutoffAt,
    session: { assistantMessageId: message.id, outputSequence: 0, rawReplyContent: null, lastObservedErrorText: null, terminalFailure: null, messageEnded: false },
  };
}

export async function invokeRuntimeMessage(
  invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => Promise<{ content: string; sessionId?: string | null }>,
  context: StreamingContext,
  input: SnailRuntimeMessageInput
): Promise<{ reply: string; messageId: number }> {
  const reply = await invokeMessage(input, (event) => handleStreamingEvent(context, event));
  context.session.rawReplyContent = typeof reply.content === "string" ? reply.content : null;
  if (reply.sessionId !== undefined) {
    context.deps.updateConversationRuntimeSessionId(context.conversationId, input.snail.name, reply.sessionId ?? null);
  }
  return { reply: reply.content ?? "", messageId: context.session.assistantMessageId };
}

export function appendSemanticReplyEvents(context: StreamingContext, events: CreateMessageEventInput[]): MessageEvent[] {
  const persisted = context.deps.store.addMessageEvents(context.session.assistantMessageId, events);
  for (const event of persisted) emitEventAppended({ deps: context.deps, conversationId: context.conversationId, snailName: context.activeSnail.name, messageId: context.session.assistantMessageId, event });
  return persisted;
}

export function appendTerminalReplyTextIfNeeded(context: StreamingContext, text: string): MessageEvent[] {
  const normalizedText = text.trim();
  if (!normalizedText) return [];
  const existingEvents = context.deps.store.getMessageEvents(context.session.assistantMessageId);
  const lastText = [...existingEvents].reverse().find((event) => event.kind === "text")?.payload as { text?: string } | undefined;
  if (lastText?.text === normalizedText) return [];
  return appendSemanticReplyEvents(context, [{ kind: "text", payload: { text: normalizedText, mentions: [] } }]);
}

export function finalizeMessageLifecycle(context: StreamingContext, options: MessageLifecycleFinalization): MessageEvent | null {
  if (context.session.messageEnded) return null;
  context.session.messageEnded = true;
  const normalizedErrorText = typeof options.errorText === "string" && options.errorText.trim() ? options.errorText.trim() : null;
  const status = normalizeTerminalStatus(options.status);
  const terminalEvent = status === "failed"
    ? { kind: "signal" as const, payload: { type: "message_failed" as const, reason: normalizedErrorText ?? context.session.terminalFailure ?? null, detail: null } }
    : { kind: "signal" as const, payload: { type: terminalSignalForStatus(status), reason: null, detail: null } };
  const event = context.deps.store.completeMessageWithEvent(context.session.assistantMessageId, terminalEvent, status);
  emitEventAppended({ deps: context.deps, conversationId: context.conversationId, snailName: context.activeSnail.name, messageId: context.session.assistantMessageId, event });
  context.deps.emitAgentEvent(context.conversationId, { type: "message_status_changed", message_id: context.session.assistantMessageId, status, snail_name: context.activeSnail.name, final_role: options.finalRole });
  return event;
}

function handleStreamingEvent(context: StreamingContext, event: AgentEvent): void {
  switch (event.type) {
    case "message_event":
      handleMessageEvent(context, event.event);
      break;
    case "message_failure":
      context.session.terminalFailure = event.error;
      break;
    default:
      context.deps.emitAgentEvent(context.conversationId, { ...event, message_id: context.session.assistantMessageId, snail_name: context.activeSnail.name });
  }
}

function handleMessageEvent(context: StreamingContext, eventInput: CreateMessageEventInput): void {
  if (eventInput.kind === "error") context.session.lastObservedErrorText = eventInput.payload.message;
  context.session.outputSequence += 1;
  logAgentOutput({ conversationId: context.conversationId, snail: context.activeSnail.name, runtime: context.activeSnail.runtime, sequence: context.session.outputSequence, content: summarizeEvent(eventInput) });
  const event = context.deps.store.addMessageEvent(context.session.assistantMessageId, withRuntimeSource(eventInput, normalizeRuntime(context.activeSnail.runtime)));
  emitEventAppended({ deps: context.deps, conversationId: context.conversationId, snailName: context.activeSnail.name, messageId: context.session.assistantMessageId, event });
}

function withRuntimeSource(event: CreateMessageEventInput, runtime: MessageRuntime): CreateMessageEventInput {
  return { ...event, source: { runtime_name: runtime, ...(event.source ?? {}) } } as CreateMessageEventInput;
}

function emitEventAppended(input: { deps: MessageProtocolDeps; conversationId: string; snailName: string; messageId: number; event: MessageEvent }): void {
  const { deps, conversationId, snailName, messageId, event } = input;
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: messageId, snail_name: snailName, event });
}

function normalizeTerminalStatus(status: AgentMessageStatus): Exclude<MessageStatus, "streaming"> {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "interrupted") return "interrupted";
  return "completed";
}

function terminalSignalForStatus(status: Exclude<MessageStatus, "streaming">): "message_completed" | "message_failed" | "message_interrupted" | "message_cancelled" {
  switch (status) {
    case "completed": return "message_completed";
    case "failed": return "message_failed";
    case "interrupted": return "message_interrupted";
    case "cancelled": return "message_cancelled";
  }
}

function summarizeEvent(event: CreateMessageEventInput): string {
  const summarizer = eventSummarizers[event.kind] as ((value: CreateMessageEventInput) => string) | undefined;
  return summarizer ? summarizer(event) : "";
}

const eventSummarizers: Record<string, (event: any) => string> = {
  text: (event) => event.payload.text,
  content_block: (event) => getInputContent([event]),
  tool_call: (event) => `[tool] ${event.payload.tool_name}`,
  tool_result: (event) => event.payload.error_text ?? event.payload.output_text ?? `[tool-result] ${event.payload.tool_name}`,
  command: (event) => event.payload.command,
  command_result: (event) => event.payload.output_text ?? `[command-result] ${event.payload.command}`,
  error: (event) => summarizeRuntimeError(event.payload.message),
  signal: (event) => `[signal] ${event.payload.type}${event.payload.reason ? `: ${event.payload.reason}` : ""}`,
  start: () => "[start]",
};
