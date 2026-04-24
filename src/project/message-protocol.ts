import type { AgentEvent, AgentMessageStatus, SnailRuntimeMessageInput } from "../agent/interface";
import type {
  CreateMessagePartInput,
  DeltaPartPayload,
  EndPartPayload,
  MessagePart,
  ResultPartPayload,
  SnailName,
  StartPartPayload,
} from "../persistence/store";
import type { SnailDefinition } from "../snails";
import { logAgentOutput } from "../agent/message-flow-logger";
import { summarizeRuntimeError } from "../agent/runtime-error";

export interface MessageProtocolDeps {
  emitAgentEvent: (conversationId: string, event: Record<string, unknown>) => void;
  updateConversationRuntimeSessionId: (conversationId: string, snailName: SnailName, sessionId: string | null) => void;
  store: {
    addMessage: (input: {
      conversationId: string;
      fromSnail: SnailName;
      toSnails: SnailName[];
      role: "assistant";
      contextCutoffAt: string;
    }) => { id: number };
    addMessagePart: (messageId: number, part: CreateMessagePartInput) => MessagePart;
    setMessageContent: (messageId: number, part: CreateMessagePartInput<"result", ResultPartPayload>) => void;
    getMessageParts: (messageId: number) => MessagePart[];
  };
}

export interface MessageLifecycleFinalization {
  status: AgentMessageStatus;
  finalRole: "assistant" | "system";
  errorText?: string | null;
  endedBy?: EndPartPayload["ended_by"];
}

interface StreamingSession {
  assistantMessageId: number;
  outputSequence: number;
  finalResult: ResultPartPayload | null;
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

export function createStreamingContext(input: {
  deps: MessageProtocolDeps;
  conversationId: string;
  activeSnail: SnailDefinition;
  contextCutoffAt: string;
}): StreamingContext {
  const message = input.deps.store.addMessage({
    conversationId: input.conversationId,
    fromSnail: input.activeSnail.name,
    toSnails: [],
    role: "assistant",
    contextCutoffAt: input.contextCutoffAt,
  });
  const startPayload: StartPartPayload = {
    role: "assistant",
    snail_name: input.activeSnail.name,
    runtime: input.activeSnail.runtime,
  };
  input.deps.store.addMessagePart(message.id, { kind: "start", payload: startPayload });
  input.deps.emitAgentEvent(input.conversationId, {
    type: "message_start",
    message_id: message.id,
    snail_name: input.activeSnail.name,
    role: "assistant",
  });

  return {
    deps: input.deps,
    conversationId: input.conversationId,
    activeSnail: input.activeSnail,
    contextCutoffAt: input.contextCutoffAt,
    session: {
      assistantMessageId: message.id,
      outputSequence: 0,
      finalResult: null,
      rawReplyContent: null,
      lastObservedErrorText: null,
      terminalFailure: null,
      messageEnded: false,
    },
  };
}

export async function invokeRuntimeMessage(
  invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => Promise<{ content: string; sessionId?: string | null }>,
  context: StreamingContext,
  input: SnailRuntimeMessageInput
): Promise<{ reply: string; messageId: number; resultPayload: ResultPartPayload | null }> {
  const reply = await invokeMessage(input, (event) => handleStreamingEvent(context, event));
  context.session.rawReplyContent = typeof reply.content === "string" ? reply.content : null;
  if (reply.sessionId !== undefined) {
    context.deps.updateConversationRuntimeSessionId(context.conversationId, input.snail.name, reply.sessionId ?? null);
  }

  const fallbackReplyContent = getResultPayloadContent(context.session.finalResult) ?? reply.content ?? "";

  if (context.session.finalResult) {
    context.deps.store.setMessageContent(context.session.assistantMessageId, {
      kind: "result",
      payload: context.session.finalResult,
    });
  }
  return { reply: fallbackReplyContent, messageId: context.session.assistantMessageId, resultPayload: context.session.finalResult };
}

export function finalizeMessageLifecycle(context: StreamingContext, options: MessageLifecycleFinalization): void {
  const normalizedErrorText = typeof options.errorText === "string" && options.errorText.trim()
    ? options.errorText.trim()
    : null;
  ensureTerminalResult(context, options.status, normalizedErrorText);

  emitMessageEnd(context, {
    status: options.status,
    error_text: normalizedErrorText ?? context.session.terminalFailure ?? undefined,
    ended_by: options.endedBy ?? (options.status === "error" ? "system" : "runtime"),
  }, options.finalRole);
}

function handleStreamingEvent(context: StreamingContext, event: AgentEvent): void {
  switch (event.type) {
    case "message_delta":
      handleMessageDelta(context, event.part.payload);
      break;
    case "message_failure":
      context.session.terminalFailure = event.error;
      break;
    default:
      context.deps.emitAgentEvent(context.conversationId, { ...event, message_id: context.session.assistantMessageId, snail_name: context.activeSnail.name });
  }
}

function handleMessageDelta(context: StreamingContext, payload: DeltaPartPayload): void {
  if (payload.kind === "error_observation") {
    context.session.lastObservedErrorText = payload.error_text;
  }
  appendDeltaPart(context, payload);
}

function appendDeltaPart(context: StreamingContext, payload: DeltaPartPayload): void {
  context.session.outputSequence += 1;
  logAgentOutput({
    conversationId: context.conversationId,
    snail: context.activeSnail.name,
    runtime: context.activeSnail.runtime,
    sequence: context.session.outputSequence,
    content: summarizeDeltaPayload(payload),
  });
  const part = context.deps.store.addMessagePart(context.session.assistantMessageId, {
    kind: "delta",
    payload,
  });
  context.deps.emitAgentEvent(context.conversationId, {
    type: "message_part",
    message_id: context.session.assistantMessageId,
    snail_name: context.activeSnail.name,
    part,
  });
}

function emitMessageEnd(
  context: StreamingContext,
  payload: EndPartPayload,
  finalRole: "assistant" | "system"
): void {
  if (context.session.messageEnded) {
    return;
  }
  context.session.messageEnded = true;
  context.deps.store.addMessagePart(context.session.assistantMessageId, {
    kind: "end",
    payload,
  });
  context.deps.emitAgentEvent(context.conversationId, {
    type: "message_end",
    message_id: context.session.assistantMessageId,
    status: payload.status,
    snail_name: context.activeSnail.name,
    final_role: finalRole,
  });
}

function summarizeDeltaPayload(payload: DeltaPartPayload): string {
  switch (payload.kind) {
    case "text":
      return payload.text;
    case "tool_call":
      return summarizeToolLikeDelta("tool", payload.tool_name, undefined, undefined);
    case "tool_result":
      return summarizeToolLikeDelta("tool-result", payload.tool_name, payload.output_text, payload.error_text);
    case "mcp_call":
      return summarizeToolLikeDelta("mcp", `${payload.server_name}/${payload.tool_name}`, undefined, undefined);
    case "mcp_result":
      return summarizeToolLikeDelta("mcp-result", `${payload.server_name}/${payload.tool_name}`, payload.output_text, payload.error_text);
    case "skill_call":
      return summarizeToolLikeDelta("skill", payload.skill_name, undefined, undefined);
    case "skill_result":
      return summarizeToolLikeDelta("skill-result", payload.skill_name, payload.output_text, payload.error_text);
    case "error_observation":
      return payload.error_text;
  }
}

function ensureTerminalResult(
  context: StreamingContext,
  status: AgentMessageStatus,
  normalizedErrorText: string | null
): void {
  if (context.session.finalResult) {
    return;
  }

  const rawContent = resolveTerminalRawContent(context, status, normalizedErrorText);
  if (!rawContent) {
    return;
  }

  // System-generated terminal fallback results may add display_content, but only for
  // actual error lifecycles. Successful messages should keep the raw result text only.
  const displayContent = status === "error" ? summarizeRuntimeError(rawContent) : rawContent;
  const payload: ResultPartPayload = {
    format: "plain_text",
    content: rawContent,
    ...(displayContent !== rawContent ? { display_content: displayContent } : {}),
  };
  context.session.finalResult = payload;
  context.deps.store.setMessageContent(context.session.assistantMessageId, {
    kind: "result",
    payload,
  });
  const part = context.deps.store.getMessageParts(context.session.assistantMessageId).find((messagePart) => messagePart.kind === "result");
  if (part) {
    context.deps.emitAgentEvent(context.conversationId, {
      type: "message_part",
      message_id: context.session.assistantMessageId,
      snail_name: context.activeSnail.name,
      part,
    });
  }
}

function resolveTerminalRawContent(
  context: StreamingContext,
  status: AgentMessageStatus,
  normalizedErrorText: string | null
): string | null {
  const replyContent = context.session.rawReplyContent?.trim() || null;
  if (replyContent) {
    return replyContent;
  }
  if (status === "error") {
    return context.session.terminalFailure ?? normalizedErrorText ?? context.session.lastObservedErrorText;
  }
  return null;
}

function summarizeToolLikeDelta(label: string, name: string, outputText?: string | null, errorText?: string | null): string {
  return errorText || outputText || `[${label}:${name}]`;
}

function getResultPayloadContent(payload: ResultPartPayload | null): string | null {
  if (!payload) return null;
  switch (payload.format) {
    case "plain_text":
    case "structured_text":
      return payload.content;
    case "question":
      return payload.question;
    case "question_response":
      return payload.summary;
  }
}
