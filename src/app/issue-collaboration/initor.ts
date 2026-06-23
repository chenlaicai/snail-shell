import type { IssuePort, StagePort } from "@domain/issue/port";
import type { CreateIssueInput, Issue } from "@domain/issue/model";
import type { MessagePort } from "@domain/message/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import { startupRecovery } from "@app/issue-collaboration/startup-recovery";

export interface IssueCollaborationDeps {
  issuePort: IssuePort;
  createIssue: (input: CreateIssueInput) => Issue;
  stagePort: StagePort;
  messagePort: MessagePort;
  snailPort: SnailPort;
  liteAIPort: LiteAIPort;
}

export function init(deps: IssueCollaborationDeps) {
  const adapter = new IssueCollaboration(deps);
  startupRecovery(deps.messagePort, deps.issuePort, deps.stagePort, adapter);
  return { adapter };
}
