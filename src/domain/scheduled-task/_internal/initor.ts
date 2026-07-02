import type { SQLiteDatabase } from "@infra/database";
import type { SopPort } from "@domain/sop/port";
import type { SnailPort } from "@domain/snail/port";
import type { IssuePort } from "@domain/issue/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";
import { SQLiteScheduledTaskRepository } from "@domain/scheduled-task/_internal/repository";
import { ScheduledTaskAdapter } from "@domain/scheduled-task/_internal/adapter";

/** 初始化 ScheduledTask 模块 */
export function init(
  db: SQLiteDatabase,
  sopPort: SopPort,
  snailPort: SnailPort,
  issuePort: IssuePort,
  collaboration: CollaborationInput,
) {
  const repo = new SQLiteScheduledTaskRepository(db);
  const adapter = new ScheduledTaskAdapter(repo, sopPort, snailPort, issuePort, collaboration);
  return { repo, adapter };
}
