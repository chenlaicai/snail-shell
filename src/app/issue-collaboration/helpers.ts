import type { Issue, Stage } from "@domain/issue/model";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";
import type { Message } from "@domain/message/model";

export class CollaborationHelpers {
  constructor(
    private readonly issuePort: IssuePort,
    private readonly stagePort: StagePort,
    private readonly messagePort: MessagePort
  ) {}

  initStageCursors(stage: Stage): void {
    this.messagePort.initCursor(stage.id, "user");
    for (const roleInstance of stage.role_instances) {
      this.messagePort.initCursor(stage.id, roleInstance);
    }
  }

  createInitialStage(issue: Issue, stageKey = issue.sop_snapshot.stage_definitions[0]?.key): Stage {
    if (!stageKey) throw new Error(`No stage definitions found for issue: ${issue.id}`);
    const stage = this.stagePort.createStage({
      issue_id: issue.id,
      key: stageKey,
    });
    this.initStageCursors(stage);
    return stage;
  }

  mustGetStage(stageId: string): Stage {
    const stage = this.stagePort.findStage(stageId);
    if (!stage) throw new Error(`Stage not found: ${stageId}`);
    return stage;
  }

  mustGetIssue(issueId: string): Issue {
    const issue = this.issuePort.findIssue(issueId);
    if (!issue) throw new Error(`Issue not found: ${issueId}`);
    return issue;
  }

  mustGetMessage(messageId: number): Message {
    const message = this.messagePort.getMessage(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    return message;
  }

  assertIssueOpen(issueId: string): void {
    const issue = this.issuePort.findIssue(issueId);
    if (issue?.closed_at) throw new Error(`Issue is closed: ${issueId}`);
  }
}
