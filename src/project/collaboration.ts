import type { AgentEvent, SnailRuntimeMessageInput } from "../agent/interface";
import type {
  CreateMessagePartInput,
  Conversation,
  ConversationStore,
  MessageDispatch,
  MessageWithParts,
  ResultPartPayload,
  SnailName,
} from "../persistence/store";
import type { SnailDefinition } from "../snails";
import { buildAgentMessages } from "./agent-message";
import { buildPlainTextResultPart, buildUserResultPart, getPrimaryMessageText } from "./message-parts";
import { parseAgentReply } from "./parse-agent-reply";
import { logger } from "../logger";
import { logAgentInput } from "../agent/message-flow-logger";
import { createStreamingContext, finalizeMessageLifecycle, invokeRuntimeMessage } from "./message-protocol";

const SYSTEM_SNAIL_NAME = "system";

function requireSingleResultPart(
  parts: CreateMessagePartInput[],
  role: "user" | "assistant" | "system"
): CreateMessagePartInput<"result", ResultPartPayload> {
  const resultParts = parts.filter((part) => part.kind === "result") as Array<CreateMessagePartInput<"result", ResultPartPayload>>;
  if (resultParts.length !== 1) {
    throw new Error(`${role} message must contain exactly one result part, received ${resultParts.length}`);
  }
  return resultParts[0]!;
}

function assertNoMentionsOutsideResult(parts: CreateMessagePartInput[]): void {
  const invalidPart = parts.find((part) => part.kind !== "result" && Array.isArray((part as any)?.payload?.mentions) && (part as any).payload.mentions.length > 0);
  if (invalidPart) {
    throw new Error(`mentions are only allowed on result parts, received mentions on ${invalidPart.kind}`);
  }
}

export interface CollaborationInvocationOptions {
  activeSnailName: SnailName;
  remainingRounds: number;
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
  resolveMentions: (conversationId: string, parts: CreateMessagePartInput[], isAgentReply?: boolean) => Promise<MentionResolution>;
  refreshConversationSummary: (conversationId: string) => Promise<void>;
  resolveSnail: (snailName: SnailName) => SnailDefinition | undefined;
  resolveRuntimeBySnail: (snail: SnailDefinition) => { invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => Promise<{ content: string; sessionId?: string | null }> };
  updateConversationRuntimeSessionId: (conversationId: string, snailName: SnailName, sessionId: string | null) => void;
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
  askerSnail?: SnailName | null;
}

export async function sendStructuredMessage(
  deps: CollaborationDeps,
  conversationId: string,
  userParts: CreateMessagePartInput[],
  maxCollaborationRounds: number,
  options: SendStructuredMessageOptions = {}
): Promise<{ reply: string }> {
  const { fromSnail = "Boss Snail", quotedMessageId = null, askerSnail = null } = options;

  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const contextCutoffAt = new Date().toISOString();
  const primaryUserPart = requireSingleResultPart(userParts, fromSnail === "Boss Snail" ? "user" : "assistant");
  assertNoMentionsOutsideResult(userParts);
  const mentionResolution = await deps.resolveMentions(conversationId, [primaryUserPart]);

  const toSnails = resolveMessageToSnails({
    conversation,
    mentions: mentionResolution.mentions,
    shouldFallbackToDefault: fromSnail === "Boss Snail",
    askerSnail,
    senderSnail: fromSnail,
  });
  const userMessage = deps.store.addMessage({
    conversationId,
    fromSnail,
    toSnails,
    role: fromSnail === "Boss Snail" ? "user" : "assistant",
    quotedMessageId,
    contextCutoffAt,
  });
  deps.store.setMessageContent(userMessage.id, primaryUserPart);

  const result = await drainMentionBus(deps, conversationId, maxCollaborationRounds);
  await deps.refreshConversationSummary(conversationId);
  return { reply: result.reply };
}

async function drainMentionBus(
  deps: CollaborationDeps,
  conversationId: string,
  maxCollaborationRounds: number
): Promise<{ reply: string }> {
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  let remainingRounds = maxCollaborationRounds;
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

    const isWrapUp = remainingRounds <= 0;
    const targetSnail = isWrapUp ? conversation.default_snail : nextBatch.toSnail;
    if (isWrapUp) {
      logger.info("Collaboration round limit reached, forcing wrap-up", {
        conversationId,
        defaultSnail: conversation.default_snail
      });
      persistWrapUpNotice(deps, conversationId, conversation.default_snail);
    }

    const reply = await invokeSnailBatch(deps, conversationId, nextBatch, {
      activeSnailName: targetSnail,
      remainingRounds,
      mentionAllowed: !isWrapUp,
      forcedWrapUp: isWrapUp,
    });
    lastReply = reply.reply;

    deps.store.markDispatchesConsumed(nextBatch.dispatches.map((dispatch) => dispatch.id), reply.messageId);

    if (!isWrapUp) {
      remainingRounds -= 1;
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
    remainingRounds: number;
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
    remainingRounds: options.remainingRounds,
    mentionAllowed: options.mentionAllowed,
    forcedWrapUp: options.forcedWrapUp,
  });
  const history = deps.store.getRecentConversationMessagesWindow(conversationId, 3).filter((message) => message.id <= batch.contextCutoffMessageId);
  const runtime = deps.resolveRuntimeBySnail(activeSnail);
  const latestUserParts = buildInboxPromptParts(batch.messages);
  const runtimeInput = buildRuntimeInput(conversation, activeSnail, systemPrompt, history, latestUserParts, batch.messages);

  logAgentInput(activeSnail.runtime, runtimeInput, conversation.runtime_sessions[activeSnail.name]?.sessionId ?? null);
  logger.info("Invoking agent", {
    conversationId,
    snail: activeSnail.name,
    dispatchCount: batch.dispatches.length
  });

  const streamingContext = createStreamingContext({ deps, conversationId, activeSnail, contextCutoffAt: batch.contextCutoffAt });
  try {
    const reply = await invokeRuntimeMessage(
      runtime.invokeMessage.bind(runtime),
      streamingContext,
      runtimeInput
    );

    const parsedReplyPart = parseAgentReply(reply.reply, activeSnail.name);
    const replyPart = reply.resultPayload && (reply.resultPayload.format === "question" || reply.resultPayload.format === "question_response")
      ? { kind: "result" as const, payload: reply.resultPayload }
      : parsedReplyPart;
    const mentionResolution = await deps.resolveMentions(conversationId, [replyPart], true);
    if (mentionResolution.mentions.length > 0) {
      logger.debug("Agent reply mentions resolved", {
        conversationId,
        snail: activeSnail.name,
        mentions: mentionResolution.mentions.map(m => m.snail)
      });
    }

    const toSnails = options.forcedWrapUp ? [] : resolveMessageToSnails({
      conversation,
      mentions: mentionResolution.mentions,
      shouldFallbackToDefault: false,
      askerSnail: null,
      senderSnail: activeSnail.name,
    });
    deps.store.setMessageContent(reply.messageId, replyPart);
    deps.store.updateMessageRouting(reply.messageId, toSnails);
    // A message that completed invocation and post-processing is terminally successful,
    // even if the agent reported recoverable process-error deltas while finding a path.
    finalizeMessageLifecycle(streamingContext, {
      status: streamingContext.session.terminalFailure ? "error" : "success",
      finalRole: "assistant",
    });

    return reply;
  } catch (error) {
    finalizeMessageLifecycle(streamingContext, {
      status: "error",
      finalRole: "assistant",
      errorText: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function buildRuntimeInput(
  conversation: Conversation,
  activeSnail: SnailDefinition,
  systemPrompt: string,
  history: MessageWithParts[],
  latestUserParts: CreateMessagePartInput[],
  incrementalMessages: MessageWithParts[]
): SnailRuntimeMessageInput {
  return {
    conversation,
    snail: activeSnail,
    systemPrompts: { conversation: systemPrompt },
    history: buildAgentMessages(conversation, history),
    latestUserParts,
    incrementalMessages,
  };
}

function buildInboxPromptParts(messages: MessageWithParts[]): CreateMessagePartInput[] {
  const prompt = messages
    .map((message) => {
      const speaker = message.from_snail ?? message.role;
      const text = getPrimaryMessageText(message);
      return `${speaker}:\n${text}`;
    })
    .join("\n\n");

  return [buildUserResultPart(prompt)];
}

function resolveMessageToSnails(options: {
  conversation: Conversation;
  mentions: ResolvedMention[];
  shouldFallbackToDefault: boolean;
  askerSnail: SnailName | null;
  senderSnail: SnailName;
}): SnailName[] {
  const { conversation, mentions, shouldFallbackToDefault, askerSnail, senderSnail } = options;
  const hadExplicitMentions = mentions.length > 0;
  const seen = new Set<SnailName>();
  const toSnails: SnailName[] = [];

  for (const mention of mentions) {
    // Boss Snail is also the formal user-entry identity in conversations,
    // so self-mentions from Boss Snail should be ignored the same way as any other snail.
    if (mention.snail === senderSnail) {
      continue;
    }
    if (!conversation.participating_snails.includes(mention.snail) || seen.has(mention.snail)) {
      continue;
    }
    seen.add(mention.snail);
    toSnails.push(mention.snail);
  }

  if (
    toSnails.length === 0 &&
    senderSnail === "Boss Snail" &&
    askerSnail &&
    askerSnail !== "Boss Snail" &&
    conversation.participating_snails.includes(askerSnail)
  ) {
    toSnails.push(askerSnail);
  }

  if (
    toSnails.length === 0 &&
    !hadExplicitMentions &&
    shouldFallbackToDefault &&
    conversation.participating_snails.includes(conversation.default_snail)
  ) {
    toSnails.push(conversation.default_snail);
  }

  return toSnails;
}

function persistWrapUpNotice(deps: CollaborationDeps, conversationId: string, defaultSnailName: SnailName): void {
  const wrapUpNotice = `已达到非 boss snail 协作轮数上限，转由 ${defaultSnailName} 收口。`;
  persistSystemNotice(deps, conversationId, wrapUpNotice);
}

function persistBossMentionNotice(deps: CollaborationDeps, conversationId: string, messages: MessageWithParts[]): void {
  const summary = messages
    .map((message) => `${message.from_snail ?? message.role}: ${getPrimaryMessageText(message)}`)
    .join("\n");
  const notice = `有消息 mention 到老大，等待人工回复。\n${summary}`;
  persistSystemNotice(deps, conversationId, notice);
}

function persistSystemNotice(deps: CollaborationDeps, conversationId: string, notice: string): void {
  const systemMessage = deps.store.addMessage({
    conversationId,
    fromSnail: null,
    toSnails: [],
    role: "system",
    contextCutoffAt: new Date().toISOString(),
  });
  deps.store.addMessagePart(systemMessage.id, {
    kind: "start",
    payload: { role: "system", snail_name: null, runtime: null },
  });
  deps.store.setMessageContent(systemMessage.id, buildPlainTextResultPart(notice));
  deps.store.addMessagePart(systemMessage.id, {
    kind: "end",
    payload: { status: "success", ended_by: "system" },
  });
  deps.emitAgentEvent(conversationId, {
    type: "message_start",
    message_id: systemMessage.id,
    snail_name: SYSTEM_SNAIL_NAME,
    role: "system",
  });
  const resultPart = deps.store.getMessageParts(systemMessage.id).find((part) => part.kind === "result");
  if (resultPart) {
    deps.emitAgentEvent(conversationId, {
      type: "message_part",
      message_id: systemMessage.id,
      snail_name: SYSTEM_SNAIL_NAME,
      part: resultPart,
    });
  }
  deps.emitAgentEvent(conversationId, {
    type: "message_end",
    message_id: systemMessage.id,
    status: "success",
    snail_name: SYSTEM_SNAIL_NAME,
    final_role: "system",
  });
}
