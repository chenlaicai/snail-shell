import type { MessagePort } from "@domain/message/port";
import type { StagePort } from "@domain/issue/port";
import type { IssueCollaboration } from "@app/issue-collaboration/collaboration";

export function startupRecovery(messagePort: MessagePort, stagePort: StagePort, collaboration: IssueCollaboration): void {
  const signalsByStage = messagePort.getAllCallSignals();
  const stageIds = [...signalsByStage.keys()];
  const openStageIds = new Set(stagePort.listOpenStageIds(stageIds));
  for (const stageId of stageIds) {
    if (!openStageIds.has(stageId)) continue;
    collaboration.enqueueStage(stageId);
  }
}
