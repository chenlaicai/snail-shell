import type { MessageContextSummaryGenerator } from "../llm";
import { logger } from "../logger";
import type { CreateMessageEventInput, Message, MessageContextKind } from "../shared/types";
import type { ConversationStore } from "../persistence/store";
import { buildTerminalMessageContext } from "../message-bus/message-context";

const STARTUP_RECOVERY_REASON = "server_startup_orphaned_streaming_message";
const STARTUP_RECOVERY_MESSAGE = "服务进程在该 Snail 消息写入终态前退出；当前进程无法继续或中断上一进程的运行，已在启动时收敛为中断状态。";

export interface StartupRecoveryResult {
  recovered_message_ids: number[];
  failed_message_ids: number[];
}

export async function recoverOrphanedStreamingAssistantMessages(input: {
  store: Pick<ConversationStore, "listStreamingAssistantMessages" | "getMessage" | "getMessageEvents" | "addMessageEvent" | "completeMessageWithEvent" | "upsertMessageContext">;
  summaryGenerator?: MessageContextSummaryGenerator | null;
}): Promise<StartupRecoveryResult> {
  const messages = input.store.listStreamingAssistantMessages();
  const recoveredMessageIds: number[] = [];
  const failedMessageIds: number[] = [];
  for (const message of messages) {
    try {
      const recovered = await recoverMessage({ ...input, message });
      if (recovered) recoveredMessageIds.push(message.id);
    } catch (error) {
      failedMessageIds.push(message.id);
      logger.error("Failed to recover orphaned streaming assistant message", { messageId: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (recoveredMessageIds.length > 0) {
    logger.warn("Recovered orphaned streaming assistant messages", { messageIds: recoveredMessageIds });
  }

  return { recovered_message_ids: recoveredMessageIds, failed_message_ids: failedMessageIds };
}

async function recoverMessage(input: {
  store: Pick<ConversationStore, "getMessage" | "getMessageEvents" | "addMessageEvent" | "completeMessageWithEvent" | "upsertMessageContext">;
  summaryGenerator?: MessageContextSummaryGenerator | null;
  message: Message;
}): Promise<boolean> {
  const current = input.store.getMessage(input.message.id, input.message.conversation_id);
  if (!current || current.status !== "streaming" || current.role !== "assistant") return false;

  /**
   * 启动恢复面对的是上一个进程留下的持久化事实，而不是当前进程可控的运行任务。
   * 复用正常终态写入路径可以保留“终态消息不可继续追加事件”的存储不变量。零事件消息
   * 可以安全补入合成 start；已有非 start 事件的历史脏数据不能再倒插 start，否则会破坏
   * 事件顺序事实并触发存储层首事件约束，只能追加终态 signal 将 UI 可见运行态收敛掉。
   */
  const events = input.store.getMessageEvents(current.id, current.conversation_id);
  if (events.length === 0) {
    input.store.addMessageEvent(current.id, buildSyntheticStartEvent(current), current.conversation_id);
  }

  input.store.completeMessageWithEvent(current.id, buildInterruptedSignalEvent(), "interrupted", current.conversation_id);
  const interrupted = input.store.getMessage(current.id, current.conversation_id);
  if (!interrupted) return false;
  const context = await buildRecoveredMessageContext({ ...input, message: interrupted });
  input.store.upsertMessageContext(current.id, context.kind, context.context, current.conversation_id);
  return true;
}

function buildSyntheticStartEvent(message: Message): CreateMessageEventInput {
  return {
    kind: "start",
    payload: { role: "assistant", role_name: message.from_role, runtime: message.runtime ?? "unknown" },
    source: { runtime_name: message.runtime ?? "unknown" },
  };
}

function buildInterruptedSignalEvent(): CreateMessageEventInput {
  return {
    kind: "signal",
    payload: {
      type: "message_interrupted",
      reason: STARTUP_RECOVERY_REASON,
      detail: { reason: "server_shutdown", message: STARTUP_RECOVERY_MESSAGE, forced: true },
    },
    source: { runtime_name: "system" },
  };
}

async function buildRecoveredMessageContext(input: {
  store: Pick<ConversationStore, "getMessageEvents">;
  message: Message;
  summaryGenerator?: MessageContextSummaryGenerator | null;
}): Promise<{ kind: MessageContextKind; context: string }> {
  return buildTerminalMessageContext({ message: input.message, events: input.store.getMessageEvents(input.message.id, input.message.conversation_id), summaryGenerator: input.summaryGenerator ?? null });
}
