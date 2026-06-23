import type { MessagePort } from "@domain/message/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { IssueCollaboration } from "@app/issue-collaboration/collaboration";

/**
 * 系统重启恢复：重新入队有未处理信号的 stage。
 * 已归档 issue 的 stage 不入队（archived_at !== null 的 issue 完全冻结）。
 */
export function startupRecovery(messagePort: MessagePort, issuePort: IssuePort, stagePort: StagePort, collaboration: IssueCollaboration): void {
  const signalsByStage = messagePort.getAllCallSignals();
  for (const stageId of signalsByStage.keys()) {
    const stage = stagePort.findStage(stageId);
    if (stage) {
      const issue = issuePort.findIssue(stage.issue_id);
      if (issue?.archived_at) continue; // 已归档 issue 的 stage 不重新入队
    }
    collaboration.enqueueStage(stageId);
  }
}
