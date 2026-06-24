import type { Message } from "@domain/message/model";
import type { MessagePort } from "@domain/message/port";
import type { StagePort } from "@domain/issue/port";
import type { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "startup-recovery" });

export function startupRecovery(messagePort: MessagePort, stagePort: StagePort, collaboration: IssueCollaboration): void {
  // 现有逻辑：恢复 CallSignal 驱动的 stage 排队
  const signalsByStage = messagePort.getAllCallSignals();
  const stageIds = [...signalsByStage.keys()];
  const openStageIds = new Set(stagePort.listOpenStageIds(stageIds));
  for (const stageId of stageIds) {
    if (!openStageIds.has(stageId)) continue;
    collaboration.enqueueStage(stageId);
  }

  // 新增：收敛孤儿 streaming 消息（服务重启后 activeInvocations 丢失）
  const streamingMessages = messagePort.listMessagesByStatus("streaming");
  const orphanMessages = streamingMessages.filter(m => m.from_speaker !== "user");
  if (orphanMessages.length === 0) return;

  log.info({ count: orphanMessages.length }, "converging orphan streaming messages");
  for (const message of orphanMessages) {
    try {
      convergeOrphanMessage(messagePort, message);
      log.info({ messageId: message.id, stageId: message.stage_id }, "orphan streaming message converged");
    } catch (error) {
      log.error({ messageId: message.id, err: error }, "failed to converge orphan message");
    }
  }
}

/** 收敛单条孤儿 streaming 消息：设置兜底 context + 标记 interrupted */
function convergeOrphanMessage(messagePort: MessagePort, message: Message): void {
  const existing = messagePort.getContext(message.id);
  if (existing?.kind !== "mcp_final_body") {
    const events = messagePort.getMessageEvents(message.id);
    const hasTextEvent = events.some(e => e.payload.type === "text" && (e.payload as { text: string }).text.trim());
    if (!hasTextEvent) {
      messagePort.setContext(message.id, "event_summary", "用户中断了本次回复");
    }
  }
  messagePort.completeMessage(message.id, "interrupted");
}
