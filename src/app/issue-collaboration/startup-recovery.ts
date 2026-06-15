import type { MessagePort } from "@domain/message/port";
import type { IssueCollaboration } from "./collaboration";

export function startupRecovery(messagePort: MessagePort, collaboration: IssueCollaboration): void {
  const signalsByStage = messagePort.getAllCallSignals();
  for (const stageId of signalsByStage.keys()) {
    collaboration.enqueueStage(stageId);
  }
}
