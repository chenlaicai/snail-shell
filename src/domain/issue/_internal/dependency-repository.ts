import type { SQLiteDatabase } from "@infra/database";
import type { IssueDependency } from "@domain/issue/model";

/** Issue 依赖关系仓储接口 */
export interface IssueDependencyRepository {
  create(dep: IssueDependency): void;
  listByIssue(issueId: string): IssueDependency[];
  listDependsOn(issueId: string): IssueDependency[];
  listByParentIssue(parentIssueId: string): IssueDependency[];
  wouldCreateCycle(issueId: string, dependsOn: string): boolean;
}

type IssueDependencyRow = { issue_id: string; depends_on: string; created_at: string };

const DEPENDENCY_SCHEMA = `
CREATE TABLE IF NOT EXISTS issue_dependency (
  issue_id TEXT NOT NULL,
  depends_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(issue_id, depends_on)
);
CREATE INDEX IF NOT EXISTS idx_issue_dependency_issue ON issue_dependency(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_dependency_depends ON issue_dependency(depends_on);
`;

export class SQLiteIssueDependencyRepository implements IssueDependencyRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(DEPENDENCY_SCHEMA);
  }

  create(dep: IssueDependency): void {
    this.db.run(`INSERT INTO issue_dependency (issue_id, depends_on, created_at) VALUES (?, ?, ?)`, [dep.issue_id, dep.depends_on, dep.created_at]);
  }

  listByIssue(issueId: string): IssueDependency[] {
    return this.db.all<IssueDependencyRow>(`SELECT * FROM issue_dependency WHERE issue_id = ?`, [issueId]).map(mapDep);
  }

  listDependsOn(issueId: string): IssueDependency[] {
    return this.db.all<IssueDependencyRow>(`SELECT * FROM issue_dependency WHERE depends_on = ?`, [issueId]).map(mapDep);
  }

  listByParentIssue(parentIssueId: string): IssueDependency[] {
    return this.db.all<IssueDependencyRow>(
      `SELECT d.* FROM issue_dependency d JOIN issue i ON i.id = d.issue_id WHERE i.parent_issue_id = ?`,
      [parentIssueId],
    ).map(mapDep);
  }

  wouldCreateCycle(issueId: string, dependsOn: string): boolean {
    const visited = new Set<string>();
    const queue = [dependsOn];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === issueId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const dep of this.listByIssue(current)) queue.push(dep.depends_on);
    }
    return false;
  }
}

function mapDep(row: IssueDependencyRow): IssueDependency {
  return { issue_id: row.issue_id, depends_on: row.depends_on, created_at: row.created_at };
}
