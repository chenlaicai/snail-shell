import type { IssuePort, StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import { IssueCollaboration } from "./collaboration";
import { startupRecovery } from "./startup-recovery";

export interface IssueCollaborationDeps {
  issuePort: IssuePort;
  stagePort: StagePort;
  messagePort: MessagePort;
  snailPort: SnailPort;
  liteAIPort: LiteAIPort;
}

export function init(deps: IssueCollaborationDeps) {
  const adapter = new IssueCollaboration(deps);
  startupRecovery(deps.messagePort, adapter);
  return { adapter };
}
