import type { SQLiteDatabase } from "@infra/database";
import { SQLiteIssueTemplateRepository } from "@domain/issue-template/_internal/repository";
import { IssueTemplateAdapter } from "@domain/issue-template/_internal/adapter";
import type { CreateIssuePort } from "@domain/issue-template/port";

export function init(db: SQLiteDatabase, collaboration: CreateIssuePort) {
  const repo = new SQLiteIssueTemplateRepository(db);
  const adapter = new IssueTemplateAdapter(repo, collaboration);
  return { repo, adapter };
}
