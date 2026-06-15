import type { SopPort } from "@domain/sop/port";
import { InMemoryIssueRepository, InMemoryStageRepository, InMemoryRoleSnailAssignmentRepository } from "@domain/issue/_internal/repository";
import { IssueAdapter, StageAdapter } from "@domain/issue/_internal/adapter";

/** 初始化 Issue 模块 */
export function init(sopPort: SopPort) {
  const issueRepo = new InMemoryIssueRepository();
  const stageRepo = new InMemoryStageRepository();
  const sessionRepo = new InMemoryRoleSnailAssignmentRepository();

  const issueAdapter = new IssueAdapter(issueRepo, sopPort);
  const stageAdapter = new StageAdapter(stageRepo, sessionRepo, issueRepo);

  return { issueRepo, stageRepo, sessionRepo, issueAdapter, stageAdapter };
}
