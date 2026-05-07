import type { MessageContextSummaryGenerator } from "../llm";
import { logger } from "../logger";
import type { ConversationStore, CreateMessageEventInput, Message, MessageContextKind } from "../persistence/store";
import { buildTerminalMessageContext } from "./message-context";

const STARTUP_RECOVERY_REASON = "server_startup_orphaned_streaming_message";
const STARTUP_RECOVERY_MESSAGE = "服务进程在该 Snail 消息写入终态前退出；当前进程无法继续或中断上一进程的运行，已在启动时收敛为中断状态。";

export interface StartupRecoveryResult {
  recovered_message_ids: number[];
}

export async function recoverOrphanedStreamingAssistantMessages(input: {
  store: Pick<ConversationStore, "listStreamingAssistantMessages" | "getMessage" | "getMessageEvents" | "addMessageEvent" | "completeMessageWithEvent" | "upsertMessageContext">;
  summaryGenerator?: MessageContextSummaryGenerator | null;
}): Promise<StartupRecoveryResult> {
  const messages = input.store.listStreamingAssistantMessages();
  const recoveredMessageIds: number[] = [];
  for (const message of messages) {
    const recovered = await recoverMessage({ ...input, message });
    if (recovered) recoveredMessageIds.push(message.id);
  }

  if (recoveredMessageIds.length > 0) {
    logger.warn("Recovered orphaned streaming assistant messages", { messageIds: recoveredMessageIds });
  }

  return { recovered_message_ids: recoveredMessageIds };
}

async function recoverMessage(input: {
  store: Pick<ConversationStore, "getMessage" | "getMessageEvents" | "addMessageEvent" | "completeMessageWithEvent" | "upsertMessageContext">;
  summaryGenerator?: MessageContextSummaryGenerator | null;
  message: Message;
}): Promise<boolean> {
  const current = input.store.getMessage(input.message.id);
  if (!current || current.status !== "streaming" || current.role !== "assistant") return false;

  /**
   * 启动恢复面对的是上一个进程留下的持久化事实，而不是当前进程可控的运行任务。
   * 复用正常终态写入路径可以保留“终态消息不可继续追加事件”的存储不变量；少数历史脏数据
   * 可能在写入 start 前崩溃，因此先补一个合成 start 事件，让恢复仍保持合法事件流。
   */
  const events = input.store.getMessageEvents(current.id);
  if (!events.some((event) => event.kind === "start")) {
    input.store.addMessageEvent(current.id, buildSyntheticStartEvent(current));
  }

  input.store.completeMessageWithEvent(current.id, buildInterruptedSignalEvent(), "interrupted");
  const interrupted = input.store.getMessage(current.id);
  if (!interrupted) return false;
  const context = await buildRecoveredMessageContext({ ...input, message: interrupted });
  input.store.upsertMessageContext(current.id, context.kind, context.context);
  return true;
}

function buildSyntheticStartEvent(message: Message): CreateMessageEventInput {
  return {
    kind: "start",
    payload: { role: "assistant", snail_name: message.from_snail, runtime: message.runtime ?? "unknown" },
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
  return buildTerminalMessageContext({ message: input.message, events: input.store.getMessageEvents(input.message.id), summaryGenerator: input.summaryGenerator ?? null });
}
