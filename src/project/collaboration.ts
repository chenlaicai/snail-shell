import type { AgentEvent, SnailRuntimeTurnInput } from "../agent/interface";
import type {
  Conversation,
  ConversationStore,
  MessageDispatch,
  MessagePartInput,
  MessageWithParts,
  SnailName,
} from "../persistence/store";
import { PartType } from "../persistence/store";
import type { SnailDefinition } from "../snails";
import { buildAgentMessages } from "./agent-message";
import { buildContentPartWithMentions, joinPartTextByType } from "./message-parts";
import { describeToolUse } from "./tool-use";
import { logger } from "../logger";

const SYSTEM_SNAIL_NAME = "system";

export interface AgentMessageObject {
  content: string;
  mentions?: string[];
}

function extractJSON(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);

  if (objectMatch && arrayMatch) {
    return objectMatch.index! < arrayMatch.index! ? objectMatch[0] : arrayMatch[0];
  }

  return objectMatch?.[0] || arrayMatch?.[0] || null;
}

function parseAgentReply(reply: string, snailName: string): MessagePartInput[] {
  const jsonText = extractJSON(reply);

  if (jsonText) {
    try {
      if (jsonText.trim().startsWith('{')) {
        const parsed = JSON.parse(jsonText) as AgentMessageObject;
        if (parsed.content !== undefined) {
          logger.debug("Agent returned structured object", { snail: snailName });
          return [buildContentPartWithMentions(parsed.content, parsed.mentions as SnailName[] | undefined)];
        }
      }

      if (jsonText.trim().startsWith('[')) {
        const parsed = JSON.parse(jsonText) as AgentMessageObject[];
        if (Array.isArray(parsed) && parsed.every(obj => obj.content !== undefined)) {
          logger.debug("Agent returned structured array", { snail: snailName });
          return parsed.map(obj => buildContentPartWithMentions(obj.content, obj.mentions as SnailName[] | undefined));
        }
      }
    } catch (err) {
      logger.debug("Agent JSON parse failed", { snail: snailName, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return [buildContentPartWithMentions(reply)];
}

export interface CollaborationInvocationOptions {
  activeSnailName: SnailName;
  remainingTurns: number;
  mentionAllowed: boolean;
  forcedWrapUp: boolean;
}

export interface ResolvedMention {
  snail: SnailName;
  raw: string;
  source: "structured_part" | "llm_fallback";
}

export interface MentionResolution {
  mentions: ResolvedMention[];
  messageText: string;
}

interface CollaborationDeps {
  store: ConversationStore;
  emitAgentEvent: (conversationId: string, event: Record<string, unknown>) => void;
  buildConversationSystemPrompt: (conversationId: string, options: CollaborationInvocationOptions) => string;
  resolveMentions: (conversationId: string, parts: MessagePartInput[], isAgentReply?: boolean) => Promise<MentionResolution>;
  refreshConversationSummary: (conversationId: string) => Promise<void>;
  resolveSnail: (snailName: SnailName) => SnailDefinition | undefined;
  resolveRuntimeBySnail: (snail: SnailDefinition) => { invokeTurn: (input: SnailRuntimeTurnInput, onEvent: (event: AgentEvent) => void) => Promise<{ content: string; sessionId?: string | null }> };
  updateConversationRuntimeSessionId: (conversationId: string, snailName: SnailName, sessionId: string | null) => void;
}

interface StreamingSession {
  assistantMessageId: number | null;
  streamedTextChunks: string[];
  finalResultContent: string | null;
}

interface StreamingContext {
  deps: CollaborationDeps;
  session: StreamingSession;
  conversationId: string;
  activeSnail: SnailDefinition;
  contextCutoffAt: string;
}

interface InboxBatch {
  toSnail: SnailName;
  dispatches: MessageDispatch[];
  messages: MessageWithParts[];
  contextCutoffAt: string;
  contextCutoffMessageId: number;
}

interface SendStructuredMessageOptions {
  fromSnail?: SnailName;
  quotedMessageId?: number | null;
}

export async function sendStructuredMessage(
  deps: CollaborationDeps,
  conversationId: string,
  userParts: MessagePartInput[],
  maxCollaborationTurns: number,
  options: SendStructuredMessageOptions = {}
): Promise<{ reply: string }> {
  const { fromSnail = "Boss Snail", quotedMessageId = null } = options;

  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const contextCutoffAt = new Date().toISOString();
  const mentionResolution = await deps.resolveMentions(conversationId, userParts);
  if (mentionResolution.mentions.length > 0) {
    logger.debug("User message mentions resolved", {
      conversationId,
      mentions: mentionResolution.mentions.map(m => m.snail)
    });
  }

  const toSnails = resolveMessageToSnails(conversation, mentionResolution.mentions, fromSnail === "Boss Snail");
  const userMessage = deps.store.addMessage({
    conversationId,
    fromSnail,
    toSnails,
    role: fromSnail === "Boss Snail" ? "user" : "assistant",
    quotedMessageId,
    contextCutoffAt,
  });
  deps.store.replaceMessageParts(userMessage.id, userParts);
  deps.store.rebuildDispatchesForMessage(userMessage.id);

  const result = await drainMentionBus(deps, conversationId, maxCollaborationTurns);
  await deps.refreshConversationSummary(conversationId);
  return { reply: result.reply };
}

async function drainMentionBus(
  deps: CollaborationDeps,
  conversationId: string,
  maxCollaborationTurns: number
): Promise<{ reply: string }> {
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  let remainingTurns = maxCollaborationTurns;
  let lastReply = "";

  while (true) {
    const nextBatch = getNextInboxBatch(deps.store, conversationId);
    if (!nextBatch) {
      return { reply: lastReply };
    }

    if (nextBatch.toSnail === "Boss Snail") {
      deps.store.skipDispatches(nextBatch.dispatches.map((dispatch) => dispatch.id));
      persistBossMentionNotice(deps, conversationId, nextBatch.messages);
      continue;
    }

    const isWrapUp = remainingTurns <= 0;
    const targetSnail = isWrapUp ? conversation.default_snail : nextBatch.toSnail;
    if (isWrapUp) {
      logger.info("Collaboration turn limit reached, forcing wrap-up", {
        conversationId,
        defaultSnail: conversation.default_snail
      });
      persistWrapUpNotice(deps, conversationId, conversation.default_snail);
    }

    const reply = await invokeSnailBatch(deps, conversationId, nextBatch, {
      activeSnailName: targetSnail,
      remainingTurns,
      mentionAllowed: !isWrapUp,
      forcedWrapUp: isWrapUp,
    });
    lastReply = reply.reply;

    deps.store.markDispatchesConsumed(nextBatch.dispatches.map((dispatch) => dispatch.id), reply.messageId);

    if (!isWrapUp) {
      remainingTurns -= 1;
    }
  }
}

function getNextInboxBatch(store: ConversationStore, conversationId: string): InboxBatch | null {
  const pending = store.listPendingDispatches(conversationId);
  if (pending.length === 0) {
    return null;
  }

  const firstTarget = pending[0].to_snail;
  const dispatches = pending.filter((dispatch) => dispatch.to_snail === firstTarget);
  const messageIds = [...new Set(dispatches.map((dispatch) => dispatch.message_id))];
  const messages = store.getMessagesSinceSnailReply(conversationId, firstTarget);
  const contextCutoffMessageId = Math.max(...messageIds);
  const contextCutoffAt = messages.at(-1)?.created_at ?? new Date().toISOString();
  return {
    toSnail: firstTarget,
    dispatches,
    messages,
    contextCutoffAt,
    contextCutoffMessageId,
  };
}

async function invokeSnailBatch(
  deps: CollaborationDeps,
  conversationId: string,
  batch: InboxBatch,
  options: {
    activeSnailName: SnailName;
    remainingTurns: number;
    mentionAllowed: boolean;
    forcedWrapUp: boolean;
  }
): Promise<{ reply: string; messageId: number }> {
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}, targetSnail: ${options.activeSnailName}`);
  }

  const activeSnail = deps.resolveSnail(options.activeSnailName);
  if (!activeSnail) {
    throw new Error(`Snail not found: ${options.activeSnailName}, conversationId: ${conversationId}`);
  }

  const systemPrompt = deps.buildConversationSystemPrompt(conversationId, {
    activeSnailName: activeSnail.name,
    remainingTurns: options.remainingTurns,
    mentionAllowed: options.mentionAllowed,
    forcedWrapUp: options.forcedWrapUp,
  });
  const history = deps.store.getRecentConversationTurns(conversationId, 3).filter((message) => message.id <= batch.contextCutoffMessageId);
  const runtime = deps.resolveRuntimeBySnail(activeSnail);
  const latestUserParts = buildInboxPromptParts(batch.messages);

  deps.emitAgentEvent(conversationId, { type: "turn_start", snail_name: activeSnail.name });

  logger.info("Invoking agent", {
    conversationId,
    snail: activeSnail.name,
    dispatchCount: batch.dispatches.length
  });

  const reply = await invokeRuntimeTurn(
    runtime.invokeTurn.bind(runtime),
    createStreamingContext(deps, conversationId, activeSnail, batch.contextCutoffAt),
    {
      conversation,
      snail: activeSnail,
      systemPrompts: { conversation: systemPrompt },
      history: buildAgentMessages(conversation, history),
      latestUserParts,
      incrementalMessages: batch.messages,
    }
  );

  const replyParts = parseAgentReply(reply.reply, activeSnail.name);
  const mentionResolution = await deps.resolveMentions(conversationId, replyParts, true);
  if (mentionResolution.mentions.length > 0) {
    logger.debug("Agent reply mentions resolved", {
      conversationId,
      snail: activeSnail.name,
      mentions: mentionResolution.mentions.map(m => m.snail)
    });
  }

  const toSnails = options.forcedWrapUp ? [] : resolveMessageToSnails(conversation, mentionResolution.mentions, false);
  deps.store.replaceMessageParts(reply.messageId, replyParts);
  deps.store.updateMessageRouting(reply.messageId, toSnails);

  return reply;
}

function buildInboxPromptParts(messages: MessageWithParts[]): MessagePartInput[] {
  const prompt = messages
    .map((message) => {
      const speaker = message.from_snail ?? message.role;
      const text = joinPartTextByType(message.parts, [PartType.CONTENT, PartType.SYSTEM_EVENT]);
      return `${speaker}:\n${text}`;
    })
    .join("\n\n");

  return [buildContentPartWithMentions(prompt)];
}

async function invokeRuntimeTurn(
  invokeTurn: (input: SnailRuntimeTurnInput, onEvent: (event: AgentEvent) => void) => Promise<{ content: string; sessionId?: string | null }>,
  context: StreamingContext,
  input: SnailRuntimeTurnInput
): Promise<{ reply: string; messageId: number }> {
  const reply = await invokeTurn(input, (event) => handleStreamingEvent(context, event));
  if (reply.sessionId !== undefined) {
    context.deps.updateConversationRuntimeSessionId(context.conversationId, input.snail.name, reply.sessionId ?? null);
  }

  const fallbackReplyContent = context.session.finalResultContent ?? reply.content ?? context.session.streamedTextChunks.join("");

  if (context.session.assistantMessageId === null) {
    const message = context.deps.store.addMessage({
      conversationId: context.conversationId,
      fromSnail: context.activeSnail.name,
      toSnails: [],
      role: "assistant",
      contextCutoffAt: context.contextCutoffAt,
    });
    context.session.assistantMessageId = message.id;
    context.deps.store.replaceMessageParts(message.id, [buildContentPartWithMentions(fallbackReplyContent)]);
  }

  return { reply: fallbackReplyContent, messageId: context.session.assistantMessageId! };
}

function createStreamingContext(
  deps: CollaborationDeps,
  conversationId: string,
  activeSnail: SnailDefinition,
  contextCutoffAt: string
): StreamingContext {
  return {
    deps,
    conversationId,
    activeSnail,
    contextCutoffAt,
    session: {
      assistantMessageId: null,
      streamedTextChunks: [],
      finalResultContent: null,
    },
  };
}

function handleStreamingEvent(context: StreamingContext, event: AgentEvent): void {
  switch (event.type) {
    case "streaming_chunk":
      context.session.streamedTextChunks.push(event.content);
      context.deps.emitAgentEvent(context.conversationId, { ...event, snail_name: context.activeSnail.name });
      appendAssistantPart(context, { part_type: PartType.STREAMING_CHUNK, text_value: event.content });
      break;
    case "content":
      context.session.finalResultContent = event.content;
      context.deps.emitAgentEvent(context.conversationId, { ...event, snail_name: context.activeSnail.name });
      appendAssistantPart(context, { part_type: PartType.CONTENT, text_value: event.content });
      break;
    case "tool_use": {
      const toolObservation = describeToolUse(event.name, event.input);
      context.deps.emitAgentEvent(context.conversationId, { ...event, ...toolObservation, snail_name: context.activeSnail.name });
      appendAssistantPart(context, {
        part_type: PartType.TOOL_USE,
        text_value: toolObservation.summary ?? event.name,
        json_value: JSON.stringify({ ...event, ...toolObservation }),
      });
      break;
    }
    default:
      context.deps.emitAgentEvent(context.conversationId, { ...event, snail_name: context.activeSnail.name });
  }
}

function appendAssistantPart(context: StreamingContext, part: MessagePartInput): void {
  const messageId = ensureAssistantMessage(context);
  context.deps.store.addMessagePart(messageId, part);
}

function ensureAssistantMessage(context: StreamingContext): number {
  if (context.session.assistantMessageId !== null) {
    return context.session.assistantMessageId;
  }

  const message = context.deps.store.addMessage({
    conversationId: context.conversationId,
    fromSnail: context.activeSnail.name,
    toSnails: [],
    role: "assistant",
    contextCutoffAt: context.contextCutoffAt,
  });
  context.session.assistantMessageId = message.id;
  return message.id;
}

function resolveMessageToSnails(
  conversation: Conversation,
  mentions: ResolvedMention[],
  shouldFallbackToDefault: boolean
): SnailName[] {
  const seen = new Set<SnailName>();
  const toSnails: SnailName[] = [];

  for (const mention of mentions) {
    if (!conversation.participating_snails.includes(mention.snail) || seen.has(mention.snail)) {
      continue;
    }
    seen.add(mention.snail);
    toSnails.push(mention.snail);
  }

  if (toSnails.length === 0 && shouldFallbackToDefault && conversation.participating_snails.includes(conversation.default_snail)) {
    toSnails.push(conversation.default_snail);
  }

  return toSnails;
}

function persistWrapUpNotice(deps: CollaborationDeps, conversationId: string, defaultSnailName: SnailName): void {
  const wrapUpNotice = `已达到非 boss snail 协作轮数上限，转由 ${defaultSnailName} 收口。`;
  const systemMessage = deps.store.addMessage({
    conversationId,
    fromSnail: null,
    toSnails: [],
    role: "system",
    contextCutoffAt: new Date().toISOString(),
  });
  deps.store.replaceMessageParts(systemMessage.id, [{ part_type: PartType.SYSTEM_EVENT, text_value: wrapUpNotice }]);
  deps.emitAgentEvent(conversationId, {
    type: "text",
    content: `[system] ${wrapUpNotice}`,
    snail_name: SYSTEM_SNAIL_NAME,
  });
}

function persistBossMentionNotice(deps: CollaborationDeps, conversationId: string, messages: MessageWithParts[]): void {
  const summary = messages
    .map((message) => `${message.from_snail ?? message.role}: ${joinPartTextByType(message.parts, [PartType.CONTENT])}`)
    .join("\n");
  const notice = `有消息 mention 到老大，等待人工回复。\n${summary}`;
  const systemMessage = deps.store.addMessage({
    conversationId,
    fromSnail: null,
    toSnails: [],
    role: "system",
    contextCutoffAt: new Date().toISOString(),
  });
  deps.store.replaceMessageParts(systemMessage.id, [{ part_type: PartType.SYSTEM_EVENT, text_value: notice }]);
  deps.emitAgentEvent(conversationId, {
    type: "text",
    content: `[system] ${notice}`,
    snail_name: SYSTEM_SNAIL_NAME,
  });
}
