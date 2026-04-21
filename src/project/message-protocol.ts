import type { AgentEvent, AgentMessageStatus, SnailRuntimeMessageInput } from "../agent/interface";
import type { MessagePartInput, SnailName } from "../persistence/store";
import { PartType } from "../persistence/store";
import type { SnailDefinition } from "../snails";
import { buildContentPartWithMentions } from "./message-parts";
import { describeToolUse } from "./tool-use";
import { logAgentOutput } from "../agent/message-flow-logger";

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
    addMessagePart: (messageId: number, part: MessagePartInput) => void;
    setMessageContent: (messageId: number, part: MessagePartInput) => void;
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
  streamedTextChunks: string[];
  finalResultContent: string | null;
  lastObservedErrorDetail: string | null;
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
  input.deps.store.addMessagePart(message.id, {
    part_type: PartType.MESSAGE_START,
    text_value: "message_start",
    json_value: JSON.stringify({ snail_name: input.activeSnail.name, role: "assistant" }),
  });
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
      streamedTextChunks: [],
      finalResultContent: null,
      lastObservedErrorDetail: null,
      terminalFailure: null,
      messageEnded: false,
    },
  };
}

export async function invokeRuntimeMessage(
  invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => Promise<{ content: string; sessionId?: string | null }>,
  context: StreamingContext,
  input: SnailRuntimeMessageInput
): Promise<{ reply: string; messageId: number }> {
  const reply = await invokeMessage(input, (event) => handleStreamingEvent(context, event));
  if (reply.sessionId !== undefined) {
    context.deps.updateConversationRuntimeSessionId(context.conversationId, input.snail.name, reply.sessionId ?? null);
  }

  const fallbackReplyContent = context.session.finalResultContent ?? reply.content ?? context.session.streamedTextChunks.join("");

  if (fallbackReplyContent) {
    context.deps.store.setMessageContent(context.session.assistantMessageId, buildContentPartWithMentions(fallbackReplyContent));
  }
  return { reply: fallbackReplyContent, messageId: context.session.assistantMessageId };
}

export function finalizeMessageLifecycle(context: StreamingContext, options: MessageLifecycleFinalization): void {
  const normalizedErrorText = typeof options.errorText === "string" && options.errorText.trim()
    ? options.errorText.trim()
    : null;
  // `message_end(error)` is reserved for definite terminal failure. Process-level
  // error_detail events are persisted separately and must not be promoted into a
  // terminal status unless the caller explicitly finalizes the message as failed.
  if (options.status === "error" && normalizedErrorText && !context.session.terminalFailure && !context.session.lastObservedErrorDetail) {
    context.session.lastObservedErrorDetail = normalizedErrorText;
    context.session.outputSequence += 1;
    logAgentOutput({
      conversationId: context.conversationId,
      snail: context.activeSnail.name,
      runtime: context.activeSnail.runtime,
      sequence: context.session.outputSequence,
      content: normalizedErrorText,
    });
    appendAssistantPart(context, {
      part_type: PartType.ERROR,
      text_value: normalizedErrorText,
      json_value: JSON.stringify({ type: "error_detail", error: normalizedErrorText }),
    });
    context.deps.emitAgentEvent(context.conversationId, {
      type: "error_detail",
      message_id: context.session.assistantMessageId,
      snail_name: context.activeSnail.name,
      error: normalizedErrorText,
    });
  }
  emitMessageEnd(context, {
    status: options.status,
    finalRole: options.finalRole,
  });
}

function handleStreamingEvent(context: StreamingContext, event: AgentEvent): void {
  switch (event.type) {
    case "output_text_delta":
      handleOutputTextDelta(context, event.text);
      break;
    case "error_detail":
      handleObservedErrorDetail(context, event.error);
      break;
    case "terminal_failure":
      handleTerminalFailure(context, event.error);
      break;
    case "tool_use": {
      const toolObservation = describeToolUse(event.name, event.input);
      context.deps.emitAgentEvent(context.conversationId, { ...event, ...toolObservation, message_id: context.session.assistantMessageId, snail_name: context.activeSnail.name });
      appendAssistantPart(context, {
        part_type: PartType.TOOL_USE,
        text_value: toolObservation.summary ?? event.name,
        json_value: JSON.stringify({ ...event, ...toolObservation }),
      });
      break;
    }
    default:
      context.deps.emitAgentEvent(context.conversationId, { ...event, message_id: context.session.assistantMessageId, snail_name: context.activeSnail.name });
  }
}

function handleOutputTextDelta(context: StreamingContext, text: string): void {
  context.session.streamedTextChunks.push(text);
  context.session.outputSequence += 1;
  logAgentOutput({
    conversationId: context.conversationId,
    snail: context.activeSnail.name,
    runtime: context.activeSnail.runtime,
    sequence: context.session.outputSequence,
    content: text,
  });
  context.deps.emitAgentEvent(context.conversationId, {
    type: "output_text_delta",
    message_id: context.session.assistantMessageId,
    snail_name: context.activeSnail.name,
    text,
  });
  appendAssistantPart(context, { part_type: PartType.STREAMING_CHUNK, text_value: text });
}

function handleObservedErrorDetail(context: StreamingContext, error: string): void {
  context.session.lastObservedErrorDetail = error;
  context.session.outputSequence += 1;
  logAgentOutput({
    conversationId: context.conversationId,
    snail: context.activeSnail.name,
    runtime: context.activeSnail.runtime,
    sequence: context.session.outputSequence,
    content: error,
  });
  context.deps.emitAgentEvent(context.conversationId, {
    type: "error_detail",
    message_id: context.session.assistantMessageId,
    snail_name: context.activeSnail.name,
    error,
  });
  appendAssistantPart(context, {
    part_type: PartType.ERROR,
    text_value: error,
    json_value: JSON.stringify({ type: "error_detail", error }),
  });
}

function handleTerminalFailure(context: StreamingContext, error: string): void {
  context.session.terminalFailure = error;
  context.session.outputSequence += 1;
  logAgentOutput({
    conversationId: context.conversationId,
    snail: context.activeSnail.name,
    runtime: context.activeSnail.runtime,
    sequence: context.session.outputSequence,
    content: error,
  });
  appendAssistantPart(context, {
    part_type: PartType.ERROR,
    text_value: error,
    json_value: JSON.stringify({ type: "terminal_failure", error }),
  });
}

function emitMessageEnd(
  context: StreamingContext,
  options: { status: AgentMessageStatus; finalRole: "assistant" | "system" }
): void {
  if (context.session.messageEnded) {
    return;
  }
  context.session.messageEnded = true;
  context.deps.store.addMessagePart(context.session.assistantMessageId, {
    part_type: PartType.MESSAGE_END,
    text_value: options.status,
    json_value: JSON.stringify({ status: options.status, final_role: options.finalRole }),
  });
  context.deps.emitAgentEvent(context.conversationId, {
    type: "message_end",
    message_id: context.session.assistantMessageId,
    status: options.status,
    snail_name: context.activeSnail.name,
    final_role: options.finalRole,
  });
}

function appendAssistantPart(context: StreamingContext, part: MessagePartInput): void {
  context.deps.store.addMessagePart(context.session.assistantMessageId, part);
}
