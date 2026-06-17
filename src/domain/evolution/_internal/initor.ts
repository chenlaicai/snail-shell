import type { SQLiteDatabase } from "@infra/database";
import type { IssuePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";
import { SQLiteEvolutionRepository } from "@domain/evolution/_internal/repository";
import { EvolutionAdapter } from "@domain/evolution/_internal/adapter";

/** 初始化 Evolution 模块 */
export function init(db: SQLiteDatabase, issuePort: IssuePort, snailPort: SnailPort, collaboration: CollaborationInput) {
  const repo = new SQLiteEvolutionRepository(db);
  const adapter = new EvolutionAdapter(repo, issuePort, snailPort, collaboration);
  return { repo, adapter };
}
