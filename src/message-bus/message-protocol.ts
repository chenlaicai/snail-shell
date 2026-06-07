import type { AgentEvent, AgentInvocationOptions, AgentMessageStatus, AgentStopDetail, SnailRuntimeMessageInput } from "../agent/interface";
import type { MessageContextSummaryGenerator } from "../shared/types";
import type { CreateMessageEventInput, Message, MessageContextKind, MessageEvent, MessageRuntime, MessageStatus, RoleName } from "../persistence/store";
import type { MessageContext } from "../shared/types";
import type { RoleDefinition } from "../roles";
import { logAgentOutput } from "../agent/message-flow-logger";
import { summarizeRuntimeError } from "../agent/runtime-error";
import { getInputContent } from "./message-events";
import { buildTerminalMessageContext } from "./message-context";
import { permissionStore } from "../agent/permission-store";

export interface MessageProtocolDeps {
  emitAgentEvent: (conversationId: string, event: Record<string, unknown>) => void;
  updateSnailAgentSessionExternalId: (sessionId: string, externalSessionId: string | null) => void;
  store: {
    addMessage: (input: { conversationId: string; fromRole: RoleName; toRoles: RoleName[]; role: "assistant"; contextCutoffAt: string; runtime: MessageRuntime; status: "streaming" }) => { id: number };
    addMessageEvent: (messageId: number, event: CreateMessageEventInput) => MessageEvent;
    completeMessageWithEvent: (messageId: number, event: CreateMessageEventInput, status: Exclude<MessageStatus, "streaming">) => MessageEvent;
    getMessageEvents: (messageId: number) => MessageEvent[];
    getMessage: (messageId: number, conversationId: string) => Message | null;
    getMessageContext: (messageId: number) => MessageContext | null;
    upsertMessageContext: (messageId: number, kind: MessageContextKind, context: string) => unknown;
  };
  messageContextSummaryGenerator?: MessageContextSummaryGenerator | null;
}

export interface MessageLifecycleFinalization {
  status: AgentMessageStatus;
  finalRole: "assistant" | "system";
  errorText?: string | null;
  stopDetail?: AgentStopDetail | null;
}

interface StreamingSession {
  assistantMessageId: number;
  outputSequence: number;
  lastObservedErrorText: string | null;
  terminalFailure: string | null;
  messageEnded: boolean;
  /** 本次 invocation 收到 permission_required 事件，消息应转为 pending_approval。 */
  pendingPermissionRequest: boolean;
}

export interface StreamingContext {
  deps: MessageProtocolDeps;
  session: StreamingSession;
  conversationId: string;
  activeRole: RoleDefinition;
  /** 已解析的 runtime 名称，用于日志和事件源标记。 */
  resolvedRuntime: MessageRuntime;
  contextCutoffAt: string;
  /** 当前 snail_agent_session.id，agent 返回 sessionId 后用于更新 external_session_id */
  snailAgentSessionId: string;
}

export function normalizeRuntime(runtime: string | null | undefined): MessageRuntime {
  if (runtime === "claude-code-cli" || runtime === "claude") return "claude";
  if (runtime === "opencode-cli" || runtime === "opencode") return "opencode";
  if (runtime === "codex-cli" || runtime === "codex") return "codex";
  if (runtime === "system") return "system";
  return "unknown";
}

export function createStreamingContext(input: { deps: MessageProtocolDeps; conversationId: string; activeRole: RoleDefinition; resolvedRuntime: MessageRuntime; contextCutoffAt: string; snailAgentSessionId: string }): StreamingContext {
  const message = input.deps.store.addMessage({
    conversationId: input.conversationId,
    fromRole: input.activeRole.name,
    toRoles: [],
    role: "assistant",
    contextCutoffAt: input.contextCutoffAt,
    runtime: input.resolvedRuntime,
    status: "streaming",
  });
  input.deps.emitAgentEvent(input.conversationId, { type: "message_started", message_id: message.id, status: "streaming", role_name: input.activeRole.name, role: "assistant" });
  const startEvent = input.deps.store.addMessageEvent(message.id, { kind: "start", payload: { role: "assistant", role_name: input.activeRole.name, runtime: input.resolvedRuntime }, source: { runtime_name: input.resolvedRuntime } });
  emitEventAppended({ deps: input.deps, conversationId: input.conversationId, roleName: input.activeRole.name, messageId: message.id, event: startEvent });
  return {
    deps: input.deps,
    conversationId: input.conversationId,
    activeRole: input.activeRole,
    resolvedRuntime: input.resolvedRuntime,
    contextCutoffAt: input.contextCutoffAt,
    snailAgentSessionId: input.snailAgentSessionId,
    session: { assistantMessageId: message.id, outputSequence: 0, lastObservedErrorText: null, terminalFailure: null, messageEnded: false, pendingPermissionRequest: false },
  };
}

export async function invokeRuntimeMessage(
  invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => Promise<{ sessionId?: string | null }>,
  context: StreamingContext,
  input: SnailRuntimeMessageInput,
  options?: AgentInvocationOptions
): Promise<{ messageId: number }> {
  const reply = await invokeMessage(input, (event) => handleStreamingEvent(context, event), options);
  if (reply.sessionId !== undefined) {
    context.deps.updateSnailAgentSessionExternalId(context.snailAgentSessionId, reply.sessionId ?? null);
  }
  return { messageId: context.session.assistantMessageId };
}

export async function finalizeMessageLifecycle(context: StreamingContext, options: MessageLifecycleFinalization): Promise<MessageEvent | null> {
  if (context.session.messageEnded) return null;
  context.session.messageEnded = true;

  /** 幂等保护：如果 message 已被外部路径（如 startup recovery）转为终态，跳过重复写入。
   *  completeMessageWithEvent 要求 status === "streaming"，而 startup recovery 等外部路径
   *  可能已经将同一条 message 标记为 interrupted/failed。此时直接 emit status_changed 保持
   *  UI 一致性即可，不应抛异常阻塞 send 流程。 */
  const currentMessage = context.deps.store.getMessage(context.session.assistantMessageId, context.conversationId);
  if (currentMessage && currentMessage.status !== "streaming") {
    const messageContext = await persistTerminalMessageContext(context);
    const terminalStatus = currentMessage.status as Exclude<MessageStatus, "streaming">;
    context.deps.emitAgentEvent(context.conversationId, { type: "message_status_changed", message_id: context.session.assistantMessageId, status: terminalStatus, role_name: context.activeRole.name, final_role: options.finalRole, context: messageContext });
    return null;
  }

  const normalizedErrorText = typeof options.errorText === "string" && options.errorText.trim() ? options.errorText.trim() : null;
  const status = normalizeTerminalStatus(options.status);
  const stopDetail = options.stopDetail ? { ...options.stopDetail } : null;
  const terminalEvent = status === "failed"
    ? { kind: "signal" as const, payload: { type: "message_failed" as const, reason: normalizedErrorText ?? context.session.terminalFailure ?? null, detail: stopDetail } }
    : { kind: "signal" as const, payload: { type: terminalSignalForStatus(status), reason: normalizedErrorText, detail: stopDetail } };
  const event = context.deps.store.completeMessageWithEvent(context.session.assistantMessageId, terminalEvent, status);
  const messageContext = await persistTerminalMessageContext(context);
  emitEventAppended({ deps: context.deps, conversationId: context.conversationId, roleName: context.activeRole.name, messageId: context.session.assistantMessageId, event });
  context.deps.emitAgentEvent(context.conversationId, { type: "message_context_updated", message_id: context.session.assistantMessageId, role_name: context.activeRole.name, context: messageContext });
  context.deps.emitAgentEvent(context.conversationId, { type: "message_status_changed", message_id: context.session.assistantMessageId, status, role_name: context.activeRole.name, final_role: options.finalRole, context: messageContext });
  return event;
}

async function persistTerminalMessageContext(context: StreamingContext): Promise<unknown> {
  /**
   * Message ids are only unique inside a conversation. Terminal context persistence must
   * resolve the message through the active conversation, otherwise a governance message can
   * accidentally read the workspace-table row with the same numeric id and persist the wrong context.
   */
  const message = context.deps.store.getMessage(context.session.assistantMessageId, context.conversationId);
  if (!message) return null;

  // 优先使用 MCP 显式提交的最终正文
  const mcpContext = context.deps.store.getMessageContext(context.session.assistantMessageId);
  if (mcpContext && mcpContext.kind === "mcp_final_body") {
    return mcpContext;
  }

  const built = await buildTerminalMessageContext({
    message,
    events: context.deps.store.getMessageEvents(context.session.assistantMessageId),
    summaryGenerator: context.deps.messageContextSummaryGenerator ?? null,
  });
  return context.deps.store.upsertMessageContext(context.session.assistantMessageId, built.kind, built.context);
}

function handleStreamingEvent(context: StreamingContext, event: AgentEvent): void {
  /**
   * 消息已终态后，agent 子进程可能仍在发送事件（竞态）。
   * 终态意味着消息内容已完整，后续事件无意义，静默丢弃。
   */
  if (context.session.messageEnded) return;
  switch (event.type) {
    case "message_event":
      handleMessageEvent(context, event.event);
      break;
    case "message_failure":
      context.session.terminalFailure = event.error;
      break;
    case "permission_required":
      context.session.pendingPermissionRequest = true;
      permissionStore.set({
        conversationId: context.conversationId,
        messageId: context.session.assistantMessageId,
        request: event.request,
        originalUserMessageId: 0,
        originalRoleName: context.activeRole.name,
        originalFromRole: "",
        createdAt: new Date().toISOString(),
      });
      context.deps.emitAgentEvent(context.conversationId, { ...event, message_id: context.session.assistantMessageId, role_name: context.activeRole.name });
      break;
    default:
      context.deps.emitAgentEvent(context.conversationId, { ...event as Record<string, unknown>, message_id: context.session.assistantMessageId, role_name: context.activeRole.name });
  }
}

function handleMessageEvent(context: StreamingContext, eventInput: CreateMessageEventInput): void {
  if (eventInput.kind === "error") context.session.lastObservedErrorText = eventInput.payload.message;
  context.session.outputSequence += 1;
  logAgentOutput({ conversationId: context.conversationId, role: context.activeRole.name, runtime: context.resolvedRuntime, sequence: context.session.outputSequence, content: summarizeEvent(eventInput) });
  const event = context.deps.store.addMessageEvent(context.session.assistantMessageId, withRuntimeSource(eventInput, context.resolvedRuntime));
  emitEventAppended({ deps: context.deps, conversationId: context.conversationId, roleName: context.activeRole.name, messageId: context.session.assistantMessageId, event });
}

function withRuntimeSource(event: CreateMessageEventInput, runtime: MessageRuntime): CreateMessageEventInput {
  return { ...event, source: { runtime_name: runtime, ...(event.source ?? {}) } } as CreateMessageEventInput;
}

function emitEventAppended(input: { deps: MessageProtocolDeps; conversationId: string; roleName: string; messageId: number; event: MessageEvent }): void {
  const { deps, conversationId, roleName, messageId, event } = input;
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: messageId, role_name: roleName, event });
}

function normalizeTerminalStatus(status: AgentMessageStatus): Exclude<MessageStatus, "streaming"> {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "interrupted") return "interrupted";
  if (status === "pending_approval") return "pending_approval";
  return "completed";
}

function terminalSignalForStatus(status: Exclude<MessageStatus, "streaming">): "message_completed" | "message_failed" | "message_interrupted" | "message_cancelled" | "message_pending_approval" {
  switch (status) {
    case "completed": return "message_completed";
    case "failed": return "message_failed";
    case "interrupted": return "message_interrupted";
    case "cancelled": return "message_cancelled";
    case "pending_approval": return "message_pending_approval";
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
