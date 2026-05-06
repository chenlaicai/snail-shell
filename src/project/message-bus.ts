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

export class MessageBusDrainError extends Error {
  readonly messageIds: number[];
  readonly causes: unknown[];

  constructor(messageIds: number[], causes: unknown[]) {
    super(causes[0] instanceof Error ? causes[0].message : "Message bus drain failed");
    this.name = "MessageBusDrainError";
    this.messageIds = messageIds;
    this.causes = causes;
  }
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
    /**
     * 同一轮已启动的 agent batch 必须一起 settle 后才能结束本次 drain。
     * 中断其中一个 message 时，其他并行 message 仍可能在写入终态；如果这里像 Promise.all 一样提前 reject，
     * conversation queue 会过早释放，下一条用户输入可能与上一轮仍在运行的 assistant message 交错。
     */
    const settled = await Promise.allSettled(executableBatches.map(async (batch) => {
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
      return reply.messageId;
    }));

    const rejectedReasons = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    const nextMessageIds = settled.flatMap((result) => result.status === "fulfilled" && result.value !== null ? [result.value] : []);

    messageIds.push(...nextMessageIds);
    if (rejectedReasons.length > 0) throw new MessageBusDrainError(messageIds, rejectedReasons);
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
    const messages = store.getDispatchInboxMessages(conversationId, toSnail, messageIds);
    const contextCutoffMessageId = Math.max(...messages.map((message) => message.id), ...messageIds);
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
