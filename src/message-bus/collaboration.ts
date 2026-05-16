import { getAgentInvocationStopDetail, isAgentInvocationInterrupted, isAgentInvocationStopped, type AgentEvent, type AgentInvocationOptions, type AgentRuntime, type SnailRuntimeMessageInput } from "../agent/interface";
import type { MessageContextSummaryGenerator } from "../llm";
import type { Conversation, ConversationStore, CreateMessageEventInput, MessageRuntime, MessageWithEvents, SnailName } from "../persistence/store";
import type { RoleDefinition } from "../snails";
import { buildAgentMessages } from "./agent-message";
import { buildPlainTextEvent, buildTextEvent, extractMentionsFromInputs, type MessageInputEvent } from "./message-events";
import { extractEmbeddedMessageOutCandidate, parseMessageOutPayload } from "./message-out";
import { logger } from "../logger";
import { logAgentInput } from "../agent/message-flow-logger";
import { createStreamingContext, finalizeMessageLifecycle, invokeRuntimeMessage, normalizeRuntime } from "./message-protocol";
import { drainMessageBus, MessageBusDrainError, type MessageBusBatch } from "./message-bus";
import { buildTerminalMessageContext, formatMessageContextForPrompt } from "./message-context";

const SYSTEM_SNAIL_NAME = "system";

export interface CollaborationInvocationOptions {
  activeRoleName: SnailName;
  remainingRounds: number;
  mentionAllowed: boolean;
  forcedWrapUp: boolean;
  runtime?: AgentRuntime;
}

export interface ResolvedMention {
  snail: SnailName;
  raw: string;
  source: "structured_event" | "llm_fallback";
}

export interface MentionResolution {
  mentions: ResolvedMention[];
  messageText: string;
}

export interface SendStructuredMessageResult {
  messageIds: number[];
}

export interface InterruptedSnailInvocation {
  messageId: number;
  snailName: SnailName;
}

export class CollaborationInterruptedError extends Error {
  readonly interruptedInvocations: InterruptedSnailInvocation[];

  constructor(interruptedInvocations: InterruptedSnailInvocation[]) {
    super("Collaboration interrupted");
    this.name = "CollaborationInterruptedError";
    this.interruptedInvocations = interruptedInvocations;
  }
}

interface CollaborationDeps {
  store: ConversationStore;
  emitAgentEvent: (conversationId: string, event: Record<string, unknown>) => void;
  buildConversationSystemPrompt: (conversationId: string, options: CollaborationInvocationOptions) => string;
  resolveMentions: (conversationId: string, events: MessageInputEvent[], isAgentMessage?: boolean) => Promise<MentionResolution>;
  refreshConversationSummary: (conversationId: string) => Promise<void>;
  messageContextSummaryGenerator?: MessageContextSummaryGenerator | null;
  resolveRole: (roleName: SnailName) => RoleDefinition | undefined;
  resolveRuntimeByRole: (role: RoleDefinition) => { invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => Promise<{ sessionId?: string | null }>; runtime: AgentRuntime };
  /** 从 Snail Den 获取指定 snail 的 model 配置；snail 未关联 template 时返回 undefined。 */
  resolveModelForRole?: (role: RoleDefinition) => string | undefined;
  /** 从 Snail Den 获取指定 snail 的上下文窗口大小；snail 未关联 template 时返回 undefined。 */
  resolveContextWindowForRole?: (role: RoleDefinition) => number | undefined;
  updateConversationRuntimeSessionId: (conversationId: string, snailName: SnailName, sessionId: string | null) => void;
  createInterruptController: () => AbortController;
  bindInterruptMessage: (conversationId: string, messageId: number, controller: AbortController) => void;
  finishInterruptMessage: (conversationId: string, messageId: number) => void;
}

interface SendStructuredMessageOptions {
  fromRole?: SnailName;
  quotedMessageId?: number | null;
  askerRole?: SnailName | null;
  clientId?: string | null;
}

export async function sendStructuredMessage(deps: CollaborationDeps, conversationId: string, userEvents: MessageInputEvent[], maxCollaborationRounds: number, options: SendStructuredMessageOptions = {}): Promise<SendStructuredMessageResult> {
  const { fromRole = "Boss Role", quotedMessageId = null, askerRole = null, clientId = null } = options;
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  if (userEvents.length === 0) throw new Error("message must contain at least one content event");

  const contextCutoffAt = String(deps.store.getLatestMessage(conversationId)?.id ?? 0);
  const role = fromRole === "Boss Role" ? "user" : "assistant";
  const mentionResolution = await deps.resolveMentions(conversationId, userEvents);
  /**
   * 用户追问的隐含对象来自 conversation 末尾语境，而不是默认 role 配置。
   * 这里必须通过专门的末尾读模型判断最近可自动响应的 role，避免 getMessages 默认分页截断长对话后把路由带回 default_snail。
   */
  const respondingRoleCandidates = conversation.participating_snails.filter((roleName) => isAutoRespondingRole(deps.resolveRole(roleName)));
  const latestRespondingRole = fromRole === "Boss Role" ? deps.store.getLatestRespondingSnail(conversationId, respondingRoleCandidates) : null;
  const toRoles = resolveMessageToRoles({ conversation, mentions: mentionResolution.mentions, shouldFallbackToDefault: fromRole === "Boss Role", askerRole, latestRespondingRole, senderRole: fromRole });
  const userMessage = deps.store.addMessage({ conversationId, clientId, fromSnail: fromRole, toSnails: toRoles, role, quotedMessageId, contextCutoffAt, runtime: "system", status: "streaming" });
  emitMessageStarted(deps, conversationId, userMessage.id, fromRole, role, clientId);
  appendEvent(deps, conversationId, userMessage.id, fromRole, { kind: "start", payload: { role, snail_name: fromRole, runtime: "system" }, source: { runtime_name: "system" } }, clientId);
  userEvents.forEach((event) => appendEvent(deps, conversationId, userMessage.id, fromRole, event, clientId));
  const terminalEvent = deps.store.completeMessageWithEvent(userMessage.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed", conversationId);
  const messageContext = await persistMessageContext(deps, conversationId, userMessage.id);
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: userMessage.id, snail_name: fromRole, event: terminalEvent, ...(clientId ? { client_id: clientId } : {}) });
  deps.emitAgentEvent(conversationId, { type: "message_context_updated", message_id: userMessage.id, snail_name: fromRole, context: messageContext, ...(clientId ? { client_id: clientId } : {}) });
  deps.emitAgentEvent(conversationId, { type: "message_status_changed", message_id: userMessage.id, status: "completed", snail_name: fromRole, final_role: role, context: messageContext, ...(clientId ? { client_id: clientId } : {}) });

  try {
    const result = await drainMessageBus({
      store: deps.store,
      handleBossMention: persistBossMentionNotice.bind(null, deps),
      handleWrapUp: persistWrapUpNotice.bind(null, deps),
      invokeBatch: invokeRoleBatch.bind(null, deps),
    }, conversationId, maxCollaborationRounds);
    await deps.refreshConversationSummary(conversationId);
    return { messageIds: [userMessage.id, ...result.messageIds] };
  } catch (error) {
    const interruptedResult = buildInterruptedSendResult(userMessage.id, error);
    if (interruptedResult) {
      await deps.refreshConversationSummary(conversationId);
      return interruptedResult;
    }
    throw unwrapMessageBusDrainError(error);
  }
}

function buildInterruptedSendResult(userMessageId: number, error: unknown): SendStructuredMessageResult | null {
  const interruptedErrors = getInterruptedErrors(error);
  if (interruptedErrors.length === 0) return null;
  const messageIds = [userMessageId, ...getCompletedMessageIds(error), ...interruptedErrors.flatMap((item) => item.interruptedInvocations.map((invocation) => invocation.messageId))];
  return { messageIds: Array.from(new Set(messageIds)) };
}

function getInterruptedErrors(error: unknown): CollaborationInterruptedError[] {
  if (isCollaborationInterrupted(error)) return [error];
  if (error instanceof MessageBusDrainError && error.causes.length > 0 && error.causes.every(isCollaborationInterrupted)) return error.causes;
  return [];
}

function getCompletedMessageIds(error: unknown): number[] {
  return error instanceof MessageBusDrainError ? error.messageIds : [];
}

function unwrapMessageBusDrainError(error: unknown): unknown {
  if (error instanceof MessageBusDrainError && error.causes.length === 1) return error.causes[0];
  return error;
}

async function invokeRoleBatch(deps: CollaborationDeps, conversationId: string, batch: MessageBusBatch, options: CollaborationInvocationOptions): Promise<{ messageId: number }> {
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}, targetRole: ${options.activeRoleName}`);
  const activeRole = deps.resolveRole(options.activeRoleName);
  if (!activeRole) throw new Error(`Role not found: ${options.activeRoleName}, conversationId: ${conversationId}`);
  if (!isAgentRole(activeRole)) throw new Error(`Role is not an agent: ${options.activeRoleName}, conversationId: ${conversationId}`);
  const runtime = deps.resolveRuntimeByRole(activeRole);
  const systemPrompt = deps.buildConversationSystemPrompt(conversationId, { ...options, runtime: runtime.runtime });
  const inboxMessageIds = new Set(batch.messages.map((message) => message.id));
  const history = deps.store.getRecentConversationMessagesWindow(conversationId, 3).filter((message) => message.id <= batch.contextCutoffMessageId && !inboxMessageIds.has(message.id));
  const model = deps.resolveModelForRole?.(activeRole);
  const contextWindow = deps.resolveContextWindowForRole?.(activeRole);
  const latestUserEvents = buildInboxPromptEvents(batch.messages);
  const runtimeInput = buildRuntimeInput(conversation, activeRole, systemPrompt, history, latestUserEvents, batch.messages);
  logAgentInput(runtime.runtime, runtimeInput, conversation.runtime_sessions[activeRole.name]?.sessionId ?? null);
  logger.info("Invoking agent", { conversationId, snail: activeRole.name, dispatchCount: batch.dispatches.length });

  const streamingContext = createStreamingContext({ deps, conversationId, activeSnail: activeRole, resolvedRuntime: normalizeRuntime(runtime.runtime), contextCutoffAt: batch.contextCutoffAt });
  const controller = deps.createInterruptController();
  deps.bindInterruptMessage(conversationId, streamingContext.session.assistantMessageId, controller);
  deps.store.markConversationDispatchesConsumed(conversationId, batch.dispatches.map((dispatch) => dispatch.id), streamingContext.session.assistantMessageId);
  try {
    const result = await invokeRuntimeMessage(runtime.invokeMessage.bind(runtime), streamingContext, runtimeInput, { signal: controller.signal, model, contextWindow });
    if (streamingContext.session.terminalFailure) throw new Error(streamingContext.session.terminalFailure);
    const mentionSourceEvents = getMentionSourceEvents(deps, conversationId, result.messageId, activeRole.name);
    const toRoles = await resolveAgentMessageRouting({ deps, conversationId, conversation, activeRole, mentionSourceEvents, forcedWrapUp: options.forcedWrapUp });
    deps.store.updateMessageRouting(result.messageId, toRoles, conversationId);
    await finalizeMessageLifecycle(streamingContext, { status: streamingContext.session.terminalFailure ? "failed" : "completed", finalRole: "assistant" });
    return { messageId: result.messageId };
  } catch (error) {
    if (isAgentInvocationInterrupted(error)) {
      const stopDetail = getAgentInvocationStopDetail(error);
      await finalizeMessageLifecycle(streamingContext, { status: "interrupted", finalRole: "assistant", stopDetail });
      if (stopDetail?.forced) deps.updateConversationRuntimeSessionId(conversationId, activeRole.name, null);
      throw new CollaborationInterruptedError([{ messageId: streamingContext.session.assistantMessageId, snailName: activeRole.name }]);
    }
    const stopDetail = getAgentInvocationStopDetail(error);
    await finalizeMessageLifecycle(streamingContext, { status: "failed", finalRole: "assistant", errorText: error instanceof Error ? error.message : String(error), stopDetail });
    if (stopDetail) deps.updateConversationRuntimeSessionId(conversationId, activeRole.name, null);
    throw error;
  } finally {
    deps.finishInterruptMessage(conversationId, streamingContext.session.assistantMessageId);
  }
}

export function isCollaborationInterrupted(error: unknown): error is CollaborationInterruptedError {
  return error instanceof CollaborationInterruptedError;
}

export function isCollaborationStopFailure(error: unknown): boolean {
  return isAgentInvocationStopped(error);
}

async function resolveAgentMessageRouting(input: { deps: CollaborationDeps; conversationId: string; conversation: Conversation; activeRole: RoleDefinition; mentionSourceEvents: MessageInputEvent[]; forcedWrapUp: boolean }): Promise<SnailName[]> {
  const { deps, conversationId, conversation, activeRole, mentionSourceEvents, forcedWrapUp } = input;
  const mentionResolution = await deps.resolveMentions(conversationId, mentionSourceEvents, true);
  return forcedWrapUp ? [] : resolveMessageToRoles({ conversation, mentions: mentionResolution.mentions, shouldFallbackToDefault: false, askerRole: null, latestRespondingRole: null, senderRole: activeRole.name });
}

function getMentionSourceEvents(deps: CollaborationDeps, conversationId: string, messageId: number, snailName: string): MessageInputEvent[] {
  const events = deps.store.getMessageEvents(messageId, conversationId).flatMap((event) => {
    if (event.kind === "text" || event.kind === "content_block") return [{ kind: event.kind, payload: event.payload, source: event.source } as MessageInputEvent];
    return [];
  });
  const text = events.filter((event) => event.kind === "text").map((event) => event.payload.text).join("");
  const textIsEntireMessage = events.length > 0 && events.every((event) => event.kind === "text");
  if (textIsEntireMessage && text.trim()) return [parseMessageOutTextIfPresent(text, snailName)];
  return events;
}

function parseMessageOutTextIfPresent(text: string, snailName: string): MessageInputEvent {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith("{") ? trimmed : extractEmbeddedMessageOutCandidate(trimmed);
  if (candidate) {
    try {
      const event = parseMessageOutPayload(candidate);
      logger.debug("Agent returned message-out payload", { snail: snailName, kind: event.kind });
      return event;
    } catch (error) {
      logger.debug("Agent text is not a message-out payload; treating as plain text", { snail: snailName, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!trimmed) throw new Error(`Missing message output from ${snailName}`);
  return buildPlainTextEvent(trimmed);
}

function buildRuntimeInput(conversation: Conversation, activeRole: RoleDefinition, systemPrompt: string, history: MessageWithEvents[], latestUserEvents: CreateMessageEventInput[], incrementalMessages: MessageWithEvents[]): SnailRuntimeMessageInput {
  return { conversation, snail: activeRole, systemPrompts: { conversation: systemPrompt }, history: buildAgentMessages(conversation, history), latestUserEvents, incrementalMessages };
}

function isAgentRole(role: RoleDefinition): boolean {
  return Boolean(role.snail_template_id);
}

function isAutoRespondingRole(role: RoleDefinition | undefined): boolean {
  if (!role || role.name === "Boss Role") return false;
  return isAgentRole(role);
}

function buildInboxPromptEvents(messages: MessageWithEvents[]): MessageInputEvent[] {
  const prompt = messages.map((message) => `${message.from_snail ?? message.role}:\n${formatMessageContextForPrompt(message)}`).join("\n\n");
  return [buildTextEvent(prompt, [])];
}

function resolveMessageToRoles(options: { conversation: Conversation; mentions: ResolvedMention[]; shouldFallbackToDefault: boolean; askerRole: SnailName | null; latestRespondingRole: SnailName | null; senderRole: SnailName }): SnailName[] {
  const { conversation, mentions, shouldFallbackToDefault, askerRole, latestRespondingRole, senderRole } = options;
  const hadExplicitMentions = mentions.length > 0;
  const seen = new Set<SnailName>();
  const toRoles: SnailName[] = [];
  for (const mention of mentions) {
    if (mention.snail === senderRole) continue;
    if (!conversation.participating_snails.includes(mention.snail) || seen.has(mention.snail)) continue;
    seen.add(mention.snail);
    toRoles.push(mention.snail);
  }
  const fallbackRole = resolveFallbackRole({ conversation, hadExplicitMentions, shouldFallbackToDefault, askerRole, latestRespondingRole, senderRole });
  if (toRoles.length === 0 && fallbackRole) toRoles.push(fallbackRole);
  return toRoles;
}

function resolveFallbackRole(options: { conversation: Conversation; hadExplicitMentions: boolean; shouldFallbackToDefault: boolean; askerRole: SnailName | null; latestRespondingRole: SnailName | null; senderRole: SnailName }): SnailName | null {
  const { conversation, hadExplicitMentions, shouldFallbackToDefault, askerRole, latestRespondingRole, senderRole } = options;
  if (senderRole !== "Boss Role") return null;
  if (askerRole && askerRole !== "Boss Role" && conversation.participating_snails.includes(askerRole)) return askerRole;
  if (!hadExplicitMentions && latestRespondingRole && conversation.participating_snails.includes(latestRespondingRole)) return latestRespondingRole;
  if (!hadExplicitMentions && shouldFallbackToDefault && conversation.participating_snails.includes(conversation.default_snail)) return conversation.default_snail;
  return null;
}

function persistWrapUpNotice(deps: CollaborationDeps, conversationId: string, defaultRoleName: SnailName): void {
  persistSystemNotice(deps, conversationId, `已达到非 boss role 协作轮数上限，转由 ${defaultRoleName} 收口。`);
}

function persistBossMentionNotice(deps: CollaborationDeps, conversationId: string, messages: MessageWithEvents[]): void {
  void messages;
  /**
   * Boss Role 是人工参与者，系统消息只负责标记“需要人工接管”的状态。
   * 被 mention 的原消息已经保留在对话流和 history 工具中；这里重复拼接正文会把提醒误变成对话记录副本，放大长消息噪音。
   */
  persistSystemNotice(deps, conversationId, "有消息 mention 到老大，等待人工回复。");
}

function persistSystemNotice(deps: CollaborationDeps, conversationId: string, notice: string): void {
  const message = deps.store.addMessage({ conversationId, fromSnail: null, toSnails: [], role: "system", contextCutoffAt: String(deps.store.getLatestMessage(conversationId)?.id ?? 0), runtime: "system", status: "streaming" });
  emitMessageStarted(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, "system", null);
  appendEvent(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, { kind: "start", payload: { role: "system", snail_name: null, runtime: "system" }, source: { runtime_name: "system" } }, null);
  appendEvent(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, buildPlainTextEvent(notice), null);
  const terminalEvent = deps.store.completeMessageWithEvent(message.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed", conversationId);
  const messageContextPromise = persistMessageContext(deps, conversationId, message.id);
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: message.id, snail_name: SYSTEM_SNAIL_NAME, event: terminalEvent });
  void messageContextPromise.then((messageContext) => {
    deps.emitAgentEvent(conversationId, { type: "message_context_updated", message_id: message.id, snail_name: SYSTEM_SNAIL_NAME, context: messageContext });
    deps.emitAgentEvent(conversationId, { type: "message_status_changed", message_id: message.id, status: "completed", snail_name: SYSTEM_SNAIL_NAME, final_role: "system", context: messageContext });
  });
}

async function persistMessageContext(deps: CollaborationDeps, conversationId: string, messageId: number): Promise<unknown> {
  const message = deps.store.getMessage(messageId, conversationId);
  if (!message) return null;
  const built = await buildTerminalMessageContext({ message, events: deps.store.getMessageEvents(messageId, conversationId), summaryGenerator: deps.messageContextSummaryGenerator ?? null });
  return deps.store.upsertMessageContext(messageId, built.kind, built.context, conversationId);
}

function emitMessageStarted(deps: CollaborationDeps, conversationId: string, messageId: number, snailName: string, role: "user" | "assistant" | "system", clientId: string | null): void {
  deps.emitAgentEvent(conversationId, { type: "message_started", message_id: messageId, status: "streaming", snail_name: snailName, role, ...(clientId ? { client_id: clientId } : {}) });
}

function appendEvent(deps: CollaborationDeps, conversationId: string, messageId: number, snailName: string, event: CreateMessageEventInput, clientId: string | null): void {
  const persisted = deps.store.addMessageEvent(messageId, withSystemSource(event), conversationId);
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: messageId, snail_name: snailName, event: persisted, ...(clientId ? { client_id: clientId } : {}) });
}

function withSystemSource(event: CreateMessageEventInput): CreateMessageEventInput {
  const runtime: MessageRuntime = "system";
  return { ...event, source: { runtime_name: runtime, ...(event.source ?? {}) } } as CreateMessageEventInput;
}

export function structuredMentionsFromEvents(conversation: Conversation, events: MessageInputEvent[]): ResolvedMention[] {
  return extractMentionsFromInputs(events)
    .filter((snail) => conversation.participating_snails.includes(snail))
    .map((snail) => ({ snail, raw: `@${snail}`, source: "structured_event" as const }));
}
