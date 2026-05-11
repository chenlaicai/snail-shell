import { getAgentInvocationStopDetail, isAgentInvocationInterrupted, isAgentInvocationStopped, type AgentEvent, type AgentInvocationOptions, type SnailRuntimeMessageInput } from "../agent/interface";
import type { MessageContextSummaryGenerator } from "../llm";
import type { Conversation, ConversationStore, CreateMessageEventInput, MessageRuntime, MessageWithEvents, SnailName } from "../persistence/store";
import type { AgentSnailDefinition, SnailDefinition } from "../snails";
import { buildAgentMessages } from "./agent-message";
import { buildPlainTextEvent, buildTextEvent, extractMentionsFromInputs, type MessageInputEvent } from "./message-events";
import { extractEmbeddedMessageOutCandidate, parseMessageOutPayload } from "./message-out";
import { logger } from "../logger";
import { logAgentInput } from "../agent/message-flow-logger";
import { createStreamingContext, finalizeMessageLifecycle, invokeRuntimeMessage } from "./message-protocol";
import { drainMessageBus, MessageBusDrainError, type MessageBusBatch } from "./message-bus";
import { buildTerminalMessageContext, formatMessageContextForPrompt } from "./message-context";

const SYSTEM_SNAIL_NAME = "system";

export interface CollaborationInvocationOptions {
  activeSnailName: SnailName;
  remainingRounds: number;
  mentionAllowed: boolean;
  forcedWrapUp: boolean;
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
  resolveSnail: (snailName: SnailName) => SnailDefinition | undefined;
  resolveRuntimeBySnail: (snail: AgentSnailDefinition) => { invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => Promise<{ sessionId?: string | null }> };
  updateConversationRuntimeSessionId: (conversationId: string, snailName: SnailName, sessionId: string | null) => void;
  createInterruptController: () => AbortController;
  bindInterruptMessage: (messageId: number, controller: AbortController) => void;
  finishInterruptMessage: (messageId: number) => void;
}

interface SendStructuredMessageOptions {
  fromSnail?: SnailName;
  quotedMessageId?: number | null;
  askerSnail?: SnailName | null;
  clientId?: string | null;
}

export async function sendStructuredMessage(deps: CollaborationDeps, conversationId: string, userEvents: MessageInputEvent[], maxCollaborationRounds: number, options: SendStructuredMessageOptions = {}): Promise<SendStructuredMessageResult> {
  const { fromSnail = "Boss Snail", quotedMessageId = null, askerSnail = null, clientId = null } = options;
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  if (userEvents.length === 0) throw new Error("message must contain at least one content event");

  const previousMessage = deps.store.getLatestMessage(conversationId);
  const contextCutoffAt = String(previousMessage?.id ?? 0);
  const role = fromSnail === "Boss Snail" ? "user" : "assistant";
  const mentionResolution = await deps.resolveMentions(conversationId, userEvents);
  const previousRespondingSnail = fromSnail === "Boss Snail" ? resolvePreviousRespondingSnail(deps, conversationId, conversation) : null;
  const toSnails = resolveMessageToSnails({ conversation, mentions: mentionResolution.mentions, shouldFallbackToDefault: fromSnail === "Boss Snail", askerSnail, previousRespondingSnail, senderSnail: fromSnail });
  const userMessage = deps.store.addMessage({ conversationId, clientId, fromSnail, toSnails, role, quotedMessageId, contextCutoffAt, runtime: "system", status: "streaming" });
  emitMessageStarted(deps, conversationId, userMessage.id, fromSnail, role, clientId);
  appendEvent(deps, conversationId, userMessage.id, fromSnail, { kind: "start", payload: { role, snail_name: fromSnail, runtime: "system" }, source: { runtime_name: "system" } }, clientId);
  userEvents.forEach((event) => appendEvent(deps, conversationId, userMessage.id, fromSnail, event, clientId));
  const terminalEvent = deps.store.completeMessageWithEvent(userMessage.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed");
  const messageContext = await persistMessageContext(deps, userMessage.id);
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: userMessage.id, snail_name: fromSnail, event: terminalEvent, ...(clientId ? { client_id: clientId } : {}) });
  deps.emitAgentEvent(conversationId, { type: "message_context_updated", message_id: userMessage.id, snail_name: fromSnail, context: messageContext, ...(clientId ? { client_id: clientId } : {}) });
  deps.emitAgentEvent(conversationId, { type: "message_status_changed", message_id: userMessage.id, status: "completed", snail_name: fromSnail, final_role: role, context: messageContext, ...(clientId ? { client_id: clientId } : {}) });

  try {
    const result = await drainMessageBus({
      store: deps.store,
      handleBossMention: persistBossMentionNotice.bind(null, deps),
      handleWrapUp: persistWrapUpNotice.bind(null, deps),
      invokeBatch: invokeSnailBatch.bind(null, deps),
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

async function invokeSnailBatch(deps: CollaborationDeps, conversationId: string, batch: MessageBusBatch, options: CollaborationInvocationOptions): Promise<{ messageId: number }> {
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}, targetSnail: ${options.activeSnailName}`);
  const activeSnail = deps.resolveSnail(options.activeSnailName);
  if (!activeSnail) throw new Error(`Snail not found: ${options.activeSnailName}, conversationId: ${conversationId}`);
  if (!isAgentSnail(activeSnail)) throw new Error(`Snail is not an agent: ${options.activeSnailName}, conversationId: ${conversationId}`);
  const systemPrompt = deps.buildConversationSystemPrompt(conversationId, options);
  const inboxMessageIds = new Set(batch.messages.map((message) => message.id));
  const history = deps.store.getRecentConversationMessagesWindow(conversationId, 3).filter((message) => message.id <= batch.contextCutoffMessageId && !inboxMessageIds.has(message.id));
  const runtime = deps.resolveRuntimeBySnail(activeSnail);
  const latestUserEvents = buildInboxPromptEvents(batch.messages);
  const runtimeInput = buildRuntimeInput(conversation, activeSnail, systemPrompt, history, latestUserEvents, batch.messages);
  logAgentInput(activeSnail.runtime, runtimeInput, conversation.runtime_sessions[activeSnail.name]?.sessionId ?? null);
  logger.info("Invoking agent", { conversationId, snail: activeSnail.name, dispatchCount: batch.dispatches.length });

  const streamingContext = createStreamingContext({ deps, conversationId, activeSnail, contextCutoffAt: batch.contextCutoffAt });
  const controller = deps.createInterruptController();
  deps.bindInterruptMessage(streamingContext.session.assistantMessageId, controller);
  deps.store.markDispatchesConsumed(batch.dispatches.map((dispatch) => dispatch.id), streamingContext.session.assistantMessageId);
  try {
    const result = await invokeRuntimeMessage(runtime.invokeMessage.bind(runtime), streamingContext, runtimeInput, { signal: controller.signal });
    if (streamingContext.session.terminalFailure) throw new Error(streamingContext.session.terminalFailure);
    const mentionSourceEvents = getMentionSourceEvents(deps, result.messageId, activeSnail.name);
    const toSnails = await resolveAgentMessageRouting({ deps, conversationId, conversation, activeSnail, mentionSourceEvents, forcedWrapUp: options.forcedWrapUp });
    deps.store.updateMessageRouting(result.messageId, toSnails);
    await finalizeMessageLifecycle(streamingContext, { status: streamingContext.session.terminalFailure ? "failed" : "completed", finalRole: "assistant" });
    return { messageId: result.messageId };
  } catch (error) {
    if (isAgentInvocationInterrupted(error)) {
      const stopDetail = getAgentInvocationStopDetail(error);
      await finalizeMessageLifecycle(streamingContext, { status: "interrupted", finalRole: "assistant", stopDetail });
      if (stopDetail?.forced) deps.updateConversationRuntimeSessionId(conversationId, activeSnail.name, null);
      throw new CollaborationInterruptedError([{ messageId: streamingContext.session.assistantMessageId, snailName: activeSnail.name }]);
    }
    const stopDetail = getAgentInvocationStopDetail(error);
    await finalizeMessageLifecycle(streamingContext, { status: "failed", finalRole: "assistant", errorText: error instanceof Error ? error.message : String(error), stopDetail });
    if (stopDetail) deps.updateConversationRuntimeSessionId(conversationId, activeSnail.name, null);
    throw error;
  } finally {
    deps.finishInterruptMessage(streamingContext.session.assistantMessageId);
  }
}

export function isCollaborationInterrupted(error: unknown): error is CollaborationInterruptedError {
  return error instanceof CollaborationInterruptedError;
}

export function isCollaborationStopFailure(error: unknown): boolean {
  return isAgentInvocationStopped(error);
}

async function resolveAgentMessageRouting(input: { deps: CollaborationDeps; conversationId: string; conversation: Conversation; activeSnail: SnailDefinition; mentionSourceEvents: MessageInputEvent[]; forcedWrapUp: boolean }): Promise<SnailName[]> {
  const { deps, conversationId, conversation, activeSnail, mentionSourceEvents, forcedWrapUp } = input;
  const mentionResolution = await deps.resolveMentions(conversationId, mentionSourceEvents, true);
  return forcedWrapUp ? [] : resolveMessageToSnails({ conversation, mentions: mentionResolution.mentions, shouldFallbackToDefault: false, askerSnail: null, previousRespondingSnail: null, senderSnail: activeSnail.name });
}

function getMentionSourceEvents(deps: CollaborationDeps, messageId: number, snailName: string): MessageInputEvent[] {
  const events = deps.store.getMessageEvents(messageId).flatMap((event) => {
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

function buildRuntimeInput(conversation: Conversation, activeSnail: AgentSnailDefinition, systemPrompt: string, history: MessageWithEvents[], latestUserEvents: CreateMessageEventInput[], incrementalMessages: MessageWithEvents[]): SnailRuntimeMessageInput {
  return { conversation, snail: activeSnail, systemPrompts: { conversation: systemPrompt }, history: buildAgentMessages(conversation, history), latestUserEvents, incrementalMessages };
}

function isAgentSnail(snail: SnailDefinition): snail is AgentSnailDefinition {
  return snail.kind !== "human" && Boolean(snail.runtime);
}

function buildInboxPromptEvents(messages: MessageWithEvents[]): MessageInputEvent[] {
  const prompt = messages.map((message) => `${message.from_snail ?? message.role}:\n${formatMessageContextForPrompt(message)}`).join("\n\n");
  return [buildTextEvent(prompt, [])];
}

function resolveMessageToSnails(options: { conversation: Conversation; mentions: ResolvedMention[]; shouldFallbackToDefault: boolean; askerSnail: SnailName | null; previousRespondingSnail: SnailName | null; senderSnail: SnailName }): SnailName[] {
  const { conversation, mentions, shouldFallbackToDefault, askerSnail, previousRespondingSnail, senderSnail } = options;
  const hadExplicitMentions = mentions.length > 0;
  const seen = new Set<SnailName>();
  const toSnails: SnailName[] = [];
  for (const mention of mentions) {
    if (mention.snail === senderSnail) continue;
    if (!conversation.participating_snails.includes(mention.snail) || seen.has(mention.snail)) continue;
    seen.add(mention.snail);
    toSnails.push(mention.snail);
  }
  if (toSnails.length === 0 && senderSnail === "Boss Snail" && askerSnail && askerSnail !== "Boss Snail" && conversation.participating_snails.includes(askerSnail)) toSnails.push(askerSnail);
  if (toSnails.length === 0 && !hadExplicitMentions && shouldFallbackToDefault && previousRespondingSnail) toSnails.push(previousRespondingSnail);
  if (toSnails.length === 0 && !hadExplicitMentions && shouldFallbackToDefault && conversation.participating_snails.includes(conversation.default_snail)) toSnails.push(conversation.default_snail);
  return toSnails;
}

function resolvePreviousRespondingSnail(deps: CollaborationDeps, conversationId: string, conversation: Conversation): SnailName | null {
  /**
   * 默认回复目标依赖整条 conversation 的末尾状态，不能复用 `getMessages` 的分页默认值。
   * 长 conversation 里最早 100 条与“用户发言前最近可响应 Snail”没有稳定关系。
   */
  const candidateSnails = conversation.participating_snails.filter((snailName) => snailName !== "Boss Snail");
  return deps.store.getLatestMessageFromSnails(conversationId, candidateSnails)?.from_snail ?? null;
}

function persistWrapUpNotice(deps: CollaborationDeps, conversationId: string, defaultSnailName: SnailName): void {
  persistSystemNotice(deps, conversationId, `已达到非 boss snail 协作轮数上限，转由 ${defaultSnailName} 收口。`);
}

function persistBossMentionNotice(deps: CollaborationDeps, conversationId: string, messages: MessageWithEvents[]): void {
  void messages;
  /**
   * Boss Snail 是人工参与者，系统消息只负责标记“需要人工接管”的状态。
   * 被 mention 的原消息已经保留在对话流和 history 工具中；这里重复拼接正文会把提醒误变成对话记录副本，放大长消息噪音。
   */
  persistSystemNotice(deps, conversationId, "有消息 mention 到老大，等待人工回复。");
}

function persistSystemNotice(deps: CollaborationDeps, conversationId: string, notice: string): void {
  const message = deps.store.addMessage({ conversationId, fromSnail: null, toSnails: [], role: "system", contextCutoffAt: String(deps.store.getMessages(conversationId).at(-1)?.id ?? 0), runtime: "system", status: "streaming" });
  emitMessageStarted(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, "system", null);
  appendEvent(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, { kind: "start", payload: { role: "system", snail_name: null, runtime: "system" }, source: { runtime_name: "system" } }, null);
  appendEvent(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, buildPlainTextEvent(notice), null);
  const terminalEvent = deps.store.completeMessageWithEvent(message.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed");
  const messageContextPromise = persistMessageContext(deps, message.id);
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: message.id, snail_name: SYSTEM_SNAIL_NAME, event: terminalEvent });
  void messageContextPromise.then((messageContext) => {
    deps.emitAgentEvent(conversationId, { type: "message_context_updated", message_id: message.id, snail_name: SYSTEM_SNAIL_NAME, context: messageContext });
    deps.emitAgentEvent(conversationId, { type: "message_status_changed", message_id: message.id, status: "completed", snail_name: SYSTEM_SNAIL_NAME, final_role: "system", context: messageContext });
  });
}

async function persistMessageContext(deps: CollaborationDeps, messageId: number): Promise<unknown> {
  const message = deps.store.getMessage(messageId);
  if (!message) return null;
  const built = await buildTerminalMessageContext({ message, events: deps.store.getMessageEvents(messageId), summaryGenerator: deps.messageContextSummaryGenerator ?? null });
  return deps.store.upsertMessageContext(messageId, built.kind, built.context);
}

function emitMessageStarted(deps: CollaborationDeps, conversationId: string, messageId: number, snailName: string, role: "user" | "assistant" | "system", clientId: string | null): void {
  deps.emitAgentEvent(conversationId, { type: "message_started", message_id: messageId, status: "streaming", snail_name: snailName, role, ...(clientId ? { client_id: clientId } : {}) });
}

function appendEvent(deps: CollaborationDeps, conversationId: string, messageId: number, snailName: string, event: CreateMessageEventInput, clientId: string | null): void {
  const persisted = deps.store.addMessageEvent(messageId, withSystemSource(event));
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
