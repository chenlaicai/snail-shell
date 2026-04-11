import type { Agent, AgentEvent, AgentMessage } from "../agent/interface";
import type { Conversation, ConversationStore, MessagePartType, SnailName } from "../persistence/store";
import { buildAgentMessages } from "./agent-message";
import { describeToolUse } from "./tool-use";

export interface CollaborationInvocationOptions {
  activeSnailTitle: string;
  remainingTurns: number;
  handoffAllowed: boolean;
  forcedWrapUp: boolean;
}

export interface ResolvedSnailTarget {
  activeSnailTitle: string;
  activeSnailLabel: string;
}

interface CollaborationDeps {
  store: ConversationStore;
  agent: Agent;
  emitAgentEvent: (conversationId: string, event: Record<string, unknown>) => void;
  buildConversationSystemPrompt: (conversationId: string, options: CollaborationInvocationOptions) => string;
  resolveMentionedSnailTitle: (messageText: string, participatingSnails: SnailName[]) => string | null;
  resolveMessageTarget: (conversationId: string, userParts: Array<{ part_type: MessagePartType; content: string }>) => ResolvedSnailTarget;
  refreshConversationSummary: (conversationId: string) => Promise<void>;
  resolveSnailByTitle: (title: string) => { name: SnailName; title: string } | undefined;
}

interface StreamingSession {
  assistantMessageId: number | null;
  nextPartSequence: number;
  streamedTextChunks: string[];
  finalResultContent: string | null;
}

interface StreamingContext {
  deps: CollaborationDeps;
  session: StreamingSession;
  conversationId: string;
  activeSnailTitle: string;
}

export async function sendStructuredMessage(
  deps: CollaborationDeps,
  conversationId: string,
  userParts: Array<{ part_type: MessagePartType; content: string }>,
  maxCollaborationTurns: number
): Promise<{ reply: string }> {
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const userMessage = deps.store.addMessage(conversationId, "user");
  deps.store.replaceMessageParts(userMessage.id, userParts);

  let currentTarget = deps.resolveMessageTarget(conversationId, userParts);
  let remainingTurns = maxCollaborationTurns;
  let forcedWrapUpTriggered = false;

  while (true) {
    const invocation = await invokeSnailTurn(deps, conversationId, {
      activeSnailTitle: currentTarget.activeSnailTitle,
      remainingTurns,
      handoffAllowed: !forcedWrapUpTriggered,
      forcedWrapUp: forcedWrapUpTriggered,
    });

    const nextTarget = resolveNextTarget(deps, conversation, invocation.reply);
    if (forcedWrapUpTriggered || !nextTarget) {
      await deps.refreshConversationSummary(conversationId);
      return { reply: invocation.reply };
    }

    if (remainingTurns <= 0) {
      forcedWrapUpTriggered = true;
      currentTarget = createDefaultTarget(conversation.default_snail);
      persistWrapUpNotice(deps, conversationId, conversation.default_snail);
      continue;
    }

    remainingTurns -= 1;
    currentTarget = nextTarget;
  }
}

async function invokeSnailTurn(
  deps: CollaborationDeps,
  conversationId: string,
  options: CollaborationInvocationOptions
): Promise<{ reply: string }> {
  const history = deps.store.getRecentConversationTurns(conversationId, 3);
  const systemPrompt = deps.buildConversationSystemPrompt(conversationId, options);
  const agentMessages = buildAgentMessages(deps.store.getConversation(conversationId), history);

  deps.emitAgentEvent(conversationId, { type: "turn_start", snail_name: options.activeSnailTitle });

  if (deps.agent.chatStream) {
    return invokeStreamingTurn(
      deps.agent.chatStream.bind(deps.agent),
      createStreamingContext(deps, conversationId, options.activeSnailTitle),
      agentMessages,
      systemPrompt
    );
  }

  const reply = await deps.agent.chat(agentMessages, systemPrompt);
  const message = deps.store.addMessage(conversationId, "assistant", options.activeSnailTitle);
  deps.store.replaceMessageParts(message.id, [{ part_type: "result", content: reply.content }]);
  return { reply: reply.content };
}

async function invokeStreamingTurn(
  chatStream: NonNullable<Agent["chatStream"]>,
  context: StreamingContext,
  agentMessages: AgentMessage[],
  systemPrompt: string
): Promise<{ reply: string }> {
  const reply = await chatStream(
    agentMessages,
    (event) => handleStreamingEvent(context, event),
    systemPrompt
  );
  const fallbackReplyContent = context.session.finalResultContent ?? reply.content ?? context.session.streamedTextChunks.join("");

  if (context.session.assistantMessageId === null) {
    const message = context.deps.store.addMessage(context.conversationId, "assistant", context.activeSnailTitle);
    context.deps.store.replaceMessageParts(message.id, [{ part_type: "result", content: fallbackReplyContent }]);
  }

  return { reply: fallbackReplyContent };
}

function createStreamingContext(deps: CollaborationDeps, conversationId: string, activeSnailTitle: string): StreamingContext {
  return {
    deps,
    conversationId,
    activeSnailTitle,
    session: {
      assistantMessageId: null,
      nextPartSequence: 1,
      streamedTextChunks: [],
      finalResultContent: null,
    },
  };
}

function handleStreamingEvent(context: StreamingContext, event: AgentEvent): void {
  switch (event.type) {
    case "text":
      context.session.streamedTextChunks.push(event.content);
      context.deps.emitAgentEvent(context.conversationId, { ...event, snail_name: context.activeSnailTitle });
      appendAssistantPart(context, "text", event.content);
      break;
    case "result":
      context.session.finalResultContent = event.content;
      context.deps.emitAgentEvent(context.conversationId, { ...event, snail_name: context.activeSnailTitle });
      appendAssistantPart(context, "result", event.content);
      break;
    case "tool_use": {
      const toolObservation = describeToolUse(event.name, event.input);
      context.deps.emitAgentEvent(context.conversationId, { ...event, ...toolObservation, snail_name: context.activeSnailTitle });
      appendAssistantPart(context, "tool_use", JSON.stringify({ ...event, ...toolObservation }));
      break;
    }
    default:
      context.deps.emitAgentEvent(context.conversationId, { ...event, snail_name: context.activeSnailTitle });
  }
}

function appendAssistantPart(context: StreamingContext, partType: MessagePartType, content: string): void {
  const messageId = ensureAssistantMessage(context);
  context.deps.store.addMessagePart(messageId, context.session.nextPartSequence, partType, content);
  context.session.nextPartSequence += 1;
}

function ensureAssistantMessage(context: StreamingContext): number {
  if (context.session.assistantMessageId !== null) {
    return context.session.assistantMessageId;
  }

  const message = context.deps.store.addMessage(context.conversationId, "assistant", context.activeSnailTitle);
  context.session.assistantMessageId = message.id;
  return message.id;
}

function resolveNextTarget(
  deps: CollaborationDeps,
  conversation: Conversation,
  reply: string
): ResolvedSnailTarget | null {
  const nextSnailTitle = deps.resolveMentionedSnailTitle(reply, conversation.participating_snails);
  if (!nextSnailTitle) {
    return null;
  }

  const nextSnail = deps.resolveSnailByTitle(nextSnailTitle);
  if (!nextSnail || !conversation.participating_snails.includes(nextSnail.name)) {
    return null;
  }

  return {
    activeSnailTitle: nextSnail.title,
    activeSnailLabel: nextSnail.title,
  };
}

function createDefaultTarget(defaultSnailTitle: string): ResolvedSnailTarget {
  return {
    activeSnailTitle: defaultSnailTitle,
    activeSnailLabel: defaultSnailTitle,
  };
}

function persistWrapUpNotice(deps: CollaborationDeps, conversationId: string, defaultSnailTitle: string): void {
  const wrapUpNotice = `已达到协作轮数上限，转由 ${defaultSnailTitle} 收口。`;
  const systemMessage = deps.store.addMessage(conversationId, "system", null);
  deps.store.replaceMessageParts(systemMessage.id, [{ part_type: "system_event", content: wrapUpNotice }]);
  deps.emitAgentEvent(conversationId, {
    type: "text",
    content: `[system] ${wrapUpNotice}`,
    snail_name: "system",
  });
}
