import type { AgentEvent, SnailRuntimeMessageInput } from "../agent/interface";
import type { Conversation, ConversationStore, CreateMessageEventInput, MessageRuntime, MessageWithEvents, SnailName } from "../persistence/store";
import type { AgentSnailDefinition, SnailDefinition } from "../snails";
import { buildAgentMessages } from "./agent-message";
import { buildPlainTextEvent, buildTextEvent, extractMentionsFromInputs, renderMessageEventsForPrompt, type MessageInputEvent } from "./message-events";
import { extractEmbeddedMessageOutCandidate, parseMessageOutPayload } from "./message-out";
import { logger } from "../logger";
import { logAgentInput } from "../agent/message-flow-logger";
import { createStreamingContext, finalizeMessageLifecycle, invokeRuntimeMessage } from "./message-protocol";
import { drainMessageBus, type MessageBusBatch } from "./message-bus";

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

interface CollaborationDeps {
  store: ConversationStore;
  emitAgentEvent: (conversationId: string, event: Record<string, unknown>) => void;
  buildConversationSystemPrompt: (conversationId: string, options: CollaborationInvocationOptions) => string;
  resolveMentions: (conversationId: string, events: MessageInputEvent[], isAgentMessage?: boolean) => Promise<MentionResolution>;
  refreshConversationSummary: (conversationId: string) => Promise<void>;
  resolveSnail: (snailName: SnailName) => SnailDefinition | undefined;
  resolveRuntimeBySnail: (snail: AgentSnailDefinition) => { invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => Promise<{ sessionId?: string | null }> };
  updateConversationRuntimeSessionId: (conversationId: string, snailName: SnailName, sessionId: string | null) => void;
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

  const contextCutoffAt = new Date().toISOString();
  const role = fromSnail === "Boss Snail" ? "user" : "assistant";
  const mentionResolution = await deps.resolveMentions(conversationId, userEvents);
  const toSnails = resolveMessageToSnails({ conversation, mentions: mentionResolution.mentions, shouldFallbackToDefault: fromSnail === "Boss Snail", askerSnail, senderSnail: fromSnail });
  const userMessage = deps.store.addMessage({ conversationId, fromSnail, toSnails, role, quotedMessageId, contextCutoffAt, runtime: "system", status: "streaming" });
  emitMessageStarted(deps, conversationId, userMessage.id, fromSnail, role, clientId);
  appendEvent(deps, conversationId, userMessage.id, fromSnail, { kind: "start", payload: { role, snail_name: fromSnail, runtime: "system" }, source: { runtime_name: "system" } }, clientId);
  userEvents.forEach((event) => appendEvent(deps, conversationId, userMessage.id, fromSnail, event, clientId));
  const terminalEvent = deps.store.completeMessageWithEvent(userMessage.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed");
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: userMessage.id, snail_name: fromSnail, event: terminalEvent, ...(clientId ? { client_id: clientId } : {}) });
  deps.emitAgentEvent(conversationId, { type: "message_status_changed", message_id: userMessage.id, status: "completed", snail_name: fromSnail, final_role: role, ...(clientId ? { client_id: clientId } : {}) });

  const result = await drainMessageBus({
    store: deps.store,
    handleBossMention: persistBossMentionNotice.bind(null, deps),
    handleWrapUp: persistWrapUpNotice.bind(null, deps),
    invokeBatch: invokeSnailBatch.bind(null, deps),
  }, conversationId, maxCollaborationRounds);
  await deps.refreshConversationSummary(conversationId);
  return { messageIds: [userMessage.id, ...result.messageIds] };
}

async function invokeSnailBatch(deps: CollaborationDeps, conversationId: string, batch: MessageBusBatch, options: CollaborationInvocationOptions): Promise<{ messageId: number }> {
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}, targetSnail: ${options.activeSnailName}`);
  const activeSnail = deps.resolveSnail(options.activeSnailName);
  if (!activeSnail) throw new Error(`Snail not found: ${options.activeSnailName}, conversationId: ${conversationId}`);
  if (!isAgentSnail(activeSnail)) throw new Error(`Snail is not an agent: ${options.activeSnailName}, conversationId: ${conversationId}`);
  const systemPrompt = deps.buildConversationSystemPrompt(conversationId, options);
  const history = deps.store.getRecentConversationMessagesWindow(conversationId, 3).filter((message) => message.id <= batch.contextCutoffMessageId);
  const runtime = deps.resolveRuntimeBySnail(activeSnail);
  const latestUserEvents = buildInboxPromptEvents(batch.messages);
  const runtimeInput = buildRuntimeInput(conversation, activeSnail, systemPrompt, history, latestUserEvents, batch.messages);
  logAgentInput(activeSnail.runtime, runtimeInput, conversation.runtime_sessions[activeSnail.name]?.sessionId ?? null);
  logger.info("Invoking agent", { conversationId, snail: activeSnail.name, dispatchCount: batch.dispatches.length });

  const streamingContext = createStreamingContext({ deps, conversationId, activeSnail, contextCutoffAt: batch.contextCutoffAt });
  try {
    const result = await invokeRuntimeMessage(runtime.invokeMessage.bind(runtime), streamingContext, runtimeInput);
    if (streamingContext.session.terminalFailure) throw new Error(streamingContext.session.terminalFailure);
    const mentionSourceEvents = getMentionSourceEvents(deps, result.messageId, activeSnail.name);
    const toSnails = await resolveAgentMessageRouting({ deps, conversationId, conversation, activeSnail, mentionSourceEvents, forcedWrapUp: options.forcedWrapUp });
    deps.store.updateMessageRouting(result.messageId, toSnails);
    finalizeMessageLifecycle(streamingContext, { status: streamingContext.session.terminalFailure ? "failed" : "completed", finalRole: "assistant" });
    return { messageId: result.messageId };
  } catch (error) {
    finalizeMessageLifecycle(streamingContext, { status: "failed", finalRole: "assistant", errorText: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function resolveAgentMessageRouting(input: { deps: CollaborationDeps; conversationId: string; conversation: Conversation; activeSnail: SnailDefinition; mentionSourceEvents: MessageInputEvent[]; forcedWrapUp: boolean }): Promise<SnailName[]> {
  const { deps, conversationId, conversation, activeSnail, mentionSourceEvents, forcedWrapUp } = input;
  const mentionResolution = await deps.resolveMentions(conversationId, mentionSourceEvents, true);
  return forcedWrapUp ? [] : resolveMessageToSnails({ conversation, mentions: mentionResolution.mentions, shouldFallbackToDefault: false, askerSnail: null, senderSnail: activeSnail.name });
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
  const prompt = messages.map((message) => `${message.from_snail ?? message.role}:\n${renderMessageEventsForPrompt(message)}`).join("\n\n");
  return [buildTextEvent(prompt, [])];
}

function resolveMessageToSnails(options: { conversation: Conversation; mentions: ResolvedMention[]; shouldFallbackToDefault: boolean; askerSnail: SnailName | null; senderSnail: SnailName }): SnailName[] {
  const { conversation, mentions, shouldFallbackToDefault, askerSnail, senderSnail } = options;
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
  if (toSnails.length === 0 && !hadExplicitMentions && shouldFallbackToDefault && conversation.participating_snails.includes(conversation.default_snail)) toSnails.push(conversation.default_snail);
  return toSnails;
}

function persistWrapUpNotice(deps: CollaborationDeps, conversationId: string, defaultSnailName: SnailName): void {
  persistSystemNotice(deps, conversationId, `已达到非 boss snail 协作轮数上限，转由 ${defaultSnailName} 收口。`);
}

function persistBossMentionNotice(deps: CollaborationDeps, conversationId: string, messages: MessageWithEvents[]): void {
  const summary = messages.map((message) => `${message.from_snail ?? message.role}:\n${renderMessageEventsForPrompt(message)}`).join("\n");
  persistSystemNotice(deps, conversationId, `有消息 mention 到老大，等待人工回复。\n${summary}`);
}

function persistSystemNotice(deps: CollaborationDeps, conversationId: string, notice: string): void {
  const message = deps.store.addMessage({ conversationId, fromSnail: null, toSnails: [], role: "system", contextCutoffAt: new Date().toISOString(), runtime: "system", status: "streaming" });
  emitMessageStarted(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, "system", null);
  appendEvent(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, { kind: "start", payload: { role: "system", snail_name: null, runtime: "system" }, source: { runtime_name: "system" } }, null);
  appendEvent(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, buildPlainTextEvent(notice), null);
  const terminalEvent = deps.store.completeMessageWithEvent(message.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed");
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: message.id, snail_name: SYSTEM_SNAIL_NAME, event: terminalEvent });
  deps.emitAgentEvent(conversationId, { type: "message_status_changed", message_id: message.id, status: "completed", snail_name: SYSTEM_SNAIL_NAME, final_role: "system" });
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
