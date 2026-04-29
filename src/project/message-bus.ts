import type { ConversationStore, MessageDispatch, MessageWithEvents, SnailName } from "../persistence/store";

export interface MessageBusInvocationOptions {
  activeSnailName: SnailName;
  remainingRounds: number;
  mentionAllowed: boolean;
  forcedWrapUp: boolean;
}

export interface MessageBusBatch {
  toSnail: SnailName;
  dispatches: MessageDispatch[];
  messages: MessageWithEvents[];
  contextCutoffAt: string;
  contextCutoffMessageId: number;
}

export interface MessageBusDeps {
  store: ConversationStore;
  handleBossMention: (conversationId: string, messages: MessageWithEvents[]) => void;
  handleWrapUp: (conversationId: string, defaultSnailName: SnailName) => void;
  invokeBatch: (conversationId: string, batch: MessageBusBatch, options: MessageBusInvocationOptions) => Promise<{ messageId: number }>;
}

export async function drainMessageBus(deps: MessageBusDeps, conversationId: string, maxCollaborationRounds: number): Promise<{ messageIds: number[] }> {
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

  let remainingRounds = maxCollaborationRounds;
  const messageIds: number[] = [];

  while (true) {
    const batches = getPendingInboxBatches(deps.store, conversationId);
    if (batches.length === 0) return { messageIds };

    const executableBatches = selectExecutableBatches(batches, remainingRounds);
    const nextMessageIds = await Promise.all(executableBatches.map(async (batch) => {
      if (batch.toSnail === "Boss Snail") {
        deps.store.skipDispatches(batch.dispatches.map((dispatch) => dispatch.id));
        deps.handleBossMention(conversationId, batch.messages);
        return null;
      }

      const isWrapUp = remainingRounds <= 0;
      const targetSnail = isWrapUp ? conversation.default_snail : batch.toSnail;
      if (isWrapUp) deps.handleWrapUp(conversationId, conversation.default_snail);

      const reply = await deps.invokeBatch(conversationId, batch, {
        activeSnailName: targetSnail,
        remainingRounds,
        mentionAllowed: !isWrapUp,
        forcedWrapUp: isWrapUp,
      });
      deps.store.markDispatchesConsumed(batch.dispatches.map((dispatch) => dispatch.id), reply.messageId);
      return reply.messageId;
    }));

    messageIds.push(...nextMessageIds.filter((messageId): messageId is number => messageId !== null));
    const agentBatchCount = executableBatches.filter((batch) => batch.toSnail !== "Boss Snail").length;
    remainingRounds -= Math.min(remainingRounds, agentBatchCount);
  }
}

function selectExecutableBatches(batches: MessageBusBatch[], remainingRounds: number): MessageBusBatch[] {
  const maxAgentBatches = remainingRounds <= 0 ? 1 : remainingRounds;
  let selectedAgentBatches = 0;
  return batches.filter((batch) => {
    if (batch.toSnail === "Boss Snail") return true;
    if (selectedAgentBatches >= maxAgentBatches) return false;
    selectedAgentBatches += 1;
    return true;
  });
}

function getPendingInboxBatches(store: ConversationStore, conversationId: string): MessageBusBatch[] {
  const pending = store.listPendingDispatches(conversationId);
  if (pending.length === 0) return [];

  return groupDispatchesByTarget(pending).map(([toSnail, dispatches]) => {
    const messageIds = [...new Set(dispatches.map((dispatch) => dispatch.message_id))];
    const messages = store.getMessagesSinceSnailReply(conversationId, toSnail);
    const contextCutoffMessageId = Math.max(...messageIds);
    return {
      toSnail,
      dispatches,
      messages,
      contextCutoffAt: messages.at(-1)?.created_at ?? new Date().toISOString(),
      contextCutoffMessageId,
    };
  });
}

function groupDispatchesByTarget(dispatches: MessageDispatch[]): Array<[SnailName, MessageDispatch[]]> {
  const grouped = new Map<SnailName, MessageDispatch[]>();
  for (const dispatch of dispatches) {
    const existing = grouped.get(dispatch.to_snail) ?? [];
    existing.push(dispatch);
    grouped.set(dispatch.to_snail, existing);
  }
  return Array.from(grouped.entries());
}
