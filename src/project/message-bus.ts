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
  forcedWrapUp: boolean;
}

export function claimInboxBatch(store: ConversationStore, conversationId: string, toSnail: SnailName, claimToken: string): MessageBusBatch | null {
  const dispatches = store.claimPendingDispatches(conversationId, toSnail, claimToken);
  if (dispatches.length === 0) return null;
  return buildBatch(store, conversationId, toSnail, dispatches);
}

export function releaseInboxBatch(store: ConversationStore, batch: MessageBusBatch, claimToken: string): void {
  store.releaseClaimedDispatches(batch.dispatches.map((dispatch) => dispatch.id), claimToken);
}

function buildBatch(store: ConversationStore, conversationId: string, toSnail: SnailName, dispatches: MessageDispatch[]): MessageBusBatch {
  const messageIds = [...new Set(dispatches.map((dispatch) => dispatch.message_id))];
  const messages = store.getMessagesSinceSnailReply(conversationId, toSnail);
  const contextCutoffMessageId = Math.max(...messageIds);
  return {
    toSnail,
    dispatches,
    messages,
    contextCutoffAt: messages.at(-1)?.created_at ?? new Date().toISOString(),
    contextCutoffMessageId,
    forcedWrapUp: dispatches.some((dispatch) => Boolean(dispatch.forced_wrap_up)),
  };
}
