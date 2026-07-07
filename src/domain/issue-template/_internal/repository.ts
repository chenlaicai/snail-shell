import type { SQLiteDatabase } from "@infra/database";
import type {
  IssueTemplate,
  IssueTemplateWithLastExecution,
  IssueTemplateExecution,
  IssueTemplateChild,
  CreateIssueTemplateInput,
  UpdateIssueTemplateInput,
} from "@domain/issue-template/model";
import type { Sop } from "@domain/sop/model";
import type { IssueSnailAssignmentPlan } from "@domain/issue/model";

export interface IssueTemplateRepository {
  findAll(): IssueTemplateWithLastExecution[];
  findById(id: string): IssueTemplate | undefined;
  create(input: CreateIssueTemplateInput): IssueTemplate;
  update(id: string, input: UpdateIssueTemplateInput): IssueTemplate;
  remove(id: string): void;
  findEnabled(): IssueTemplate[];
  updateSpawned(id: string, lastSpawnedAt: string, consecutiveFailures: number): void;
  toggleEnabled(id: string, enabled: boolean): void;
  createExecution(exec: Omit<IssueTemplateExecution, "id">): IssueTemplateExecution;
  listExecutions(templateId: string): IssueTemplateExecution[];
  updateExecution(id: string, status: "success" | "failed", childIssueId: string | null, error: string | null): void;
  findLastExecution(templateId: string): IssueTemplateExecution | null;
  insertChild(templateId: string, childIssueId: string): void;
  listChildren(templateId: string): IssueTemplateChild[];
}

interface RawTemplateRow {
  id: string;
  workspace_path: string;
  title: string;
  sop_key: string;
  sop_snapshot: string;
  snail_assignment_plan: string;
  cron_expression: string;
  enabled: number;
  last_spawned_at: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

interface RawTemplateWithLastExecRow extends RawTemplateRow {
  last_status: string | null;
  last_child_issue_id: string | null;
}

interface RawExecutionRow {
  id: string;
  template_id: string;
  child_issue_id: string | null;
  status: string;
  error: string | null;
  executed_at: string;
}

interface RawChildRow {
  template_id: string;
  child_issue_id: string;
  title: string;
  closed_at: string | null;
  workspace_path: string;
  created_at: string;
}

export class SQLiteIssueTemplateRepository implements IssueTemplateRepository {
  constructor(private db: SQLiteDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS issue_template (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        title TEXT NOT NULL,
        sop_key TEXT NOT NULL,
        sop_snapshot TEXT NOT NULL,
        snail_assignment_plan TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_spawned_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS issue_template_execution (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES issue_template(id) ON DELETE CASCADE,
        child_issue_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        executed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_template_execution_template
        ON issue_template_execution(template_id, executed_at DESC);

      CREATE TABLE IF NOT EXISTS issue_template_children (
        template_id TEXT NOT NULL REFERENCES issue_template(id) ON DELETE CASCADE,
        child_issue_id TEXT NOT NULL REFERENCES issue(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY(template_id, child_issue_id)
      );
    `);
  }

  findAll(): IssueTemplateWithLastExecution[] {
    const rows = this.db.all<RawTemplateWithLastExecRow>(`
      SELECT t.*, e.status as last_status, e.child_issue_id as last_child_issue_id
      FROM issue_template t
      LEFT JOIN issue_template_execution e
        ON e.id = (
          SELECT id FROM issue_template_execution
          WHERE template_id = t.id
          ORDER BY executed_at DESC LIMIT 1
        )
      ORDER BY t.created_at DESC
    `);
    return rows.map(row => mapTemplateWithLastExec(row));
  }

  findById(id: string): IssueTemplate | undefined {
    const row = this.db.get<RawTemplateRow>(`SELECT * FROM issue_template WHERE id = ?`, [id]);
    return row ? mapTemplate(row) : undefined;
  }

  create(input: CreateIssueTemplateInput): IssueTemplate {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO issue_template (id, workspace_path, title, sop_key, sop_snapshot, snail_assignment_plan, cron_expression, enabled, last_spawned_at, consecutive_failures, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.workspace_path,
        input.title,
        input.sop_key,
        JSON.stringify(input.sop_snapshot),
        JSON.stringify(input.snail_assignment_plan),
        input.cron_expression,
        input.enabled === false ? 0 : 1,
        now,
        0,
        now,
        now,
      ],
    );
    return this.findById(id)!;
  }

  update(id: string, input: UpdateIssueTemplateInput): IssueTemplate {
    const existing = this.findById(id);
    if (!existing) throw new Error(`IssueTemplate not found: ${id}`);

    const { sets, params } = buildUpdateSets(input);
    if (sets.length === 0) return existing;

    sets.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(id);

    this.db.run(`UPDATE issue_template SET ${sets.join(", ")} WHERE id = ?`, params);
    return this.findById(id)!;
  }

  remove(id: string): void {
    this.db.run(`DELETE FROM issue_template WHERE id = ?`, [id]);
  }

  findEnabled(): IssueTemplate[] {
    const rows = this.db.all<RawTemplateRow>(`SELECT * FROM issue_template WHERE enabled = 1`);
    return rows.map(row => mapTemplate(row));
  }

  updateSpawned(id: string, lastSpawnedAt: string, consecutiveFailures: number): void {
    this.db.run(
      `UPDATE issue_template SET last_spawned_at = ?, consecutive_failures = ?, updated_at = ? WHERE id = ?`,
      [lastSpawnedAt, consecutiveFailures, new Date().toISOString(), id],
    );
  }

  toggleEnabled(id: string, enabled: boolean): void {
    if (enabled) {
      this.db.run(
        `UPDATE issue_template SET enabled = 1, consecutive_failures = 0, updated_at = ? WHERE id = ?`,
        [new Date().toISOString(), id],
      );
    } else {
      this.db.run(
        `UPDATE issue_template SET enabled = 0, updated_at = ? WHERE id = ?`,
        [new Date().toISOString(), id],
      );
    }
  }

  createExecution(exec: Omit<IssueTemplateExecution, "id">): IssueTemplateExecution {
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO issue_template_execution (id, template_id, child_issue_id, status, error, executed_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, exec.template_id, exec.child_issue_id, exec.status, exec.error, exec.executed_at],
    );
    return { id, ...exec };
  }

  listExecutions(templateId: string): IssueTemplateExecution[] {
    const rows = this.db.all<RawExecutionRow>(
      `SELECT * FROM issue_template_execution WHERE template_id = ? ORDER BY executed_at DESC`,
      [templateId],
    );
    return rows.map(row => ({
      id: row.id,
      template_id: row.template_id,
      child_issue_id: row.child_issue_id,
      status: row.status as "success" | "failed",
      error: row.error,
      executed_at: row.executed_at,
    }));
  }

  updateExecution(id: string, status: "success" | "failed", childIssueId: string | null, error: string | null): void {
    this.db.run(
      `UPDATE issue_template_execution SET status = ?, child_issue_id = ?, error = ? WHERE id = ?`,
      [status, childIssueId, error, id],
    );
  }

  findLastExecution(templateId: string): IssueTemplateExecution | null {
    const row = this.db.get<RawExecutionRow>(
      `SELECT * FROM issue_template_execution WHERE template_id = ? ORDER BY executed_at DESC LIMIT 1`,
      [templateId],
    );
    if (!row) return null;
    return {
      id: row.id,
      template_id: row.template_id,
      child_issue_id: row.child_issue_id,
      status: row.status as "success" | "failed",
      error: row.error,
      executed_at: row.executed_at,
    };
  }

  insertChild(templateId: string, childIssueId: string): void {
    this.db.run(
      `INSERT INTO issue_template_children (template_id, child_issue_id, created_at) VALUES (?, ?, ?)`,
      [templateId, childIssueId, new Date().toISOString()],
    );
  }

  listChildren(templateId: string): IssueTemplateChild[] {
    const rows = this.db.all<RawChildRow>(
      `SELECT c.template_id, c.child_issue_id, c.created_at,
              i.title, i.closed_at, i.workspace_path
       FROM issue_template_children c
       JOIN issue i ON i.id = c.child_issue_id
       WHERE c.template_id = ?
       ORDER BY c.created_at DESC`,
      [templateId],
    );
    return rows.map(row => ({
      template_id: row.template_id,
      child_issue_id: row.child_issue_id,
      title: row.title,
      status: row.closed_at ? "closed" as const : "open" as const,
      workspace_path: row.workspace_path,
      created_at: row.created_at,
    }));
  }
}

function mapTemplate(row: RawTemplateRow): IssueTemplate {
  return {
    id: row.id,
    workspace_path: row.workspace_path,
    title: row.title,
    sop_key: row.sop_key,
    sop_snapshot: JSON.parse(row.sop_snapshot) as Sop,
    snail_assignment_plan: JSON.parse(row.snail_assignment_plan) as IssueSnailAssignmentPlan,
    cron_expression: row.cron_expression,
    enabled: row.enabled === 1,
    last_spawned_at: row.last_spawned_at,
    consecutive_failures: row.consecutive_failures,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapTemplateWithLastExec(row: RawTemplateWithLastExecRow): IssueTemplateWithLastExecution {
  return {
    ...mapTemplate(row),
    last_status: row.last_status as "success" | "failed" | null,
    last_child_issue_id: row.last_child_issue_id,
  };
}

function buildUpdateSets(input: UpdateIssueTemplateInput): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
  if (input.sop_key !== undefined) { sets.push("sop_key = ?"); params.push(input.sop_key); }
  if (input.sop_snapshot !== undefined) { sets.push("sop_snapshot = ?"); params.push(JSON.stringify(input.sop_snapshot)); }
  if (input.snail_assignment_plan !== undefined) { sets.push("snail_assignment_plan = ?"); params.push(JSON.stringify(input.snail_assignment_plan)); }
  if (input.cron_expression !== undefined) { sets.push("cron_expression = ?"); params.push(input.cron_expression); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(input.enabled ? 1 : 0); }
  return { sets, params };
}
