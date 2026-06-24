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

/**
 * 收敛单条孤儿 streaming 消息：设置兜底 context + 标记 interrupted。
 * context 必须在 completeMessage 之前设置，因为 completeMessage 追加的 signal
 * 不会出现在已有事件列表中（事件列表在 append 之前快照）。
 */
function convergeOrphanMessage(messagePort: MessagePort, message: Message): void {
  const existing = messagePort.getContext(message.id);
  if (existing?.kind === "mcp_final_body") {
    /** mcp_final_body 是 Agent 通过 MCP 主动设置的最终答复，保留原值 */
  } else if (existing) {
    /** 已有 context（final_text / event_summary 等），保留原值 */
  } else {
    /** 无 context：尝试从 text event 提取，否则生成兜底摘要 */
    const events = messagePort.getMessageEvents(message.id);
    let lastTextContext: string | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const payload = events[i].payload;
      if (payload.type === "text" && (payload as { text: string }).text.trim()) {
        lastTextContext = (payload as { text: string }).text;
        break;
      }
    }
    if (lastTextContext) {
      messagePort.setContext(message.id, "final_text", lastTextContext);
    } else {
      messagePort.setContext(message.id, "event_summary", "用户中断了本次回复");
    }
  }
  /** signal 携带 restart reason，与正常中断（error message）区分 */
  messagePort.completeMessage(message.id, "interrupted", { reason: "service_restart" });
}
