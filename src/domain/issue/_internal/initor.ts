import type { SQLiteDatabase } from "@infra/database";
import type { SopPort } from "@domain/sop/port";
import { SQLiteIssueRepository, SQLiteStageRepository, SQLiteRoleSnailAssignmentRepository } from "@domain/issue/_internal/repository";
import { IssueAdapter, StageAdapter } from "@domain/issue/_internal/adapter";

/** 初始化 Issue 模块 */
export function init(sopPort: SopPort, db: SQLiteDatabase) {
  const issueRepo = new SQLiteIssueRepository(db);
  const stageRepo = new SQLiteStageRepository(db);
  const sessionRepo = new SQLiteRoleSnailAssignmentRepository(db);

  const issueAdapter = new IssueAdapter(issueRepo, sopPort);
  const stageAdapter = new StageAdapter(stageRepo, sessionRepo, issueRepo);

  return { issueRepo, stageRepo, sessionRepo, issueAdapter, stageAdapter };
}
