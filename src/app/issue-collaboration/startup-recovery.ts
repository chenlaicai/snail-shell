import type { MessagePort } from "@domain/message/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { IssueCollaboration } from "@app/issue-collaboration/collaboration";

export function startupRecovery(messagePort: MessagePort, issuePort: IssuePort, stagePort: StagePort, collaboration: IssueCollaboration): void {
  const signalsByStage = messagePort.getAllCallSignals();
  for (const stageId of signalsByStage.keys()) {
    const stage = stagePort.findStage(stageId);
    if (!stage) continue;
    const issue = issuePort.findIssue(stage.issue_id);
    if (issue?.closed_at) continue;
    collaboration.enqueueStage(stageId);
  }
}
