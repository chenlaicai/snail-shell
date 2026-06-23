import type { SQLiteDatabase } from "@infra/database";
import type { Issue, Stage, RoleSnailAssignment } from "@domain/issue/model";

// ── Issue Repository ──────────────────────────────────────────────────

export interface IssueRepository {
  findById(id: string): Issue | undefined;
  listByWorkspace(workspacePath: string, limit?: number, offset?: number): Issue[];
  create(issue: Issue): void;
  /** 更新 Issue 上下文（merge 语义） */
  updateContext(issueId: string, context: Record<string, string>): void;
}

// ── Stage Repository ──────────────────────────────────────────────────

export interface StageRepository {
  findById(id: string): Stage | undefined;
  listByIssue(issueId: string): Stage[];
  create(stage: Stage): void;
  update(stageId: string, updates: Partial<Pick<Stage, "left_at" | "output_artifacts">>): void;
  transaction<T>(fn: () => T): T;
}

// ── RoleSnailAssignment Repository ──────────────────────────────────────

export interface RoleSnailAssignmentRepository {
  /** 追加一条记录 */
  append(session: RoleSnailAssignment): void;
  /** 获取指定角色实例的最新记录 */
  getLatest(stageId: string, roleInstance: string): RoleSnailAssignment | null;
  /** 获取 stage 下每个角色实例的最新记录 */
  listLatestByStage(stageId: string): RoleSnailAssignment[];
  /** 设置 snail 实例 ID */
  setSnailInstanceId(stageId: string, roleInstance: string, snailInstanceId: string): void;
}

const ISSUE_SCHEMA = `
CREATE TABLE IF NOT EXISTS issue (
  id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  sop_snapshot TEXT NOT NULL,
  snail_assignment_plan TEXT NOT NULL,
  extendable_context TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_issue_workspace_created ON issue(workspace_path, created_at DESC);

CREATE TABLE IF NOT EXISTS stage (
  id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  issue_id TEXT NOT NULL REFERENCES issue(id),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  default_role_instance TEXT NOT NULL,
  role_instances TEXT NOT NULL,
  from_stage_id TEXT REFERENCES stage(id),
  available_transitions TEXT NOT NULL,
  output_artifacts TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  left_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stage_issue_entered ON stage(issue_id, entered_at ASC);

CREATE TABLE IF NOT EXISTS role_snail_assignment (
  stage_id TEXT NOT NULL REFERENCES stage(id),
  role_instance TEXT NOT NULL,
  seq INTEGER NOT NULL,
  snail_key TEXT NOT NULL,
  snail_instance_id TEXT,
  role_key TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(stage_id, role_instance, seq)
);

CREATE INDEX IF NOT EXISTS idx_role_snail_assignment_stage ON role_snail_assignment(stage_id);
`;

type IssueRow = {
  id: string;
  workspace_path: string;
  title: string;
  summary: string | null;
  sop_snapshot: string;
  snail_assignment_plan: string;
  extendable_context: string;
  context: string;
  created_at: string;
  closed_at: string | null;
};

type StageRow = {
  id: string;
  workspace_path: string;
  issue_id: string;
  key: string;
  title: string;
  description: string;
  default_role_instance: string;
  role_instances: string;
  from_stage_id: string | null;
  available_transitions: string;
  output_artifacts: string;
  entered_at: string;
  left_at: string | null;
};

type RoleSnailAssignmentRow = RoleSnailAssignment;

export class SQLiteIssueRepository implements IssueRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(ISSUE_SCHEMA);
  }

  findById(id: string): Issue | undefined {
    const row = this.db.get<IssueRow>(`SELECT * FROM issue WHERE id = ?`, [id]);
    return row ? mapIssue(row) : undefined;
  }

  listByWorkspace(workspacePath: string, limit = 50, offset = 0): Issue[] {
    return this.db.all<IssueRow>(
      `SELECT * FROM issue WHERE workspace_path = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [workspacePath, limit, offset],
    ).map(mapIssue);
  }

  create(issue: Issue): void {
    this.db.run(
      `INSERT INTO issue (id, workspace_path, title, summary, sop_snapshot, snail_assignment_plan, extendable_context, context, created_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        issue.id,
        issue.workspace_path,
        issue.title,
        issue.summary,
        JSON.stringify(issue.sop_snapshot),
        JSON.stringify(issue.snail_assignment_plan),
        JSON.stringify(issue.extendable_context),
        JSON.stringify(issue.context),
        issue.created_at,
        issue.closed_at,
      ],
    );
  }

  updateContext(issueId: string, context: Record<string, string>): void {
    this.db.run(
      `UPDATE issue SET context = ? WHERE id = ?`,
      [JSON.stringify(context), issueId],
    );
  }
}

export class SQLiteStageRepository implements StageRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(ISSUE_SCHEMA);
  }

  findById(id: string): Stage | undefined {
    const row = this.db.get<StageRow>(`SELECT * FROM stage WHERE id = ?`, [id]);
    return row ? mapStage(row) : undefined;
  }

  listByIssue(issueId: string): Stage[] {
    return this.db.all<StageRow>(
      `SELECT * FROM stage WHERE issue_id = ? ORDER BY entered_at ASC`,
      [issueId],
    ).map(mapStage);
  }

  create(stage: Stage): void {
    this.db.run(
      `INSERT INTO stage (id, workspace_path, issue_id, key, title, description, default_role_instance, role_instances, from_stage_id, available_transitions, output_artifacts, entered_at, left_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stage.id,
        stage.workspace_path,
        stage.issue_id,
        stage.key,
        stage.title,
        stage.description,
        stage.default_role_instance,
        JSON.stringify(stage.role_instances),
        stage.from_stage_id,
        JSON.stringify(stage.available_transitions),
        JSON.stringify(stage.output_artifacts),
        stage.entered_at,
        stage.left_at,
      ],
    );
  }
  update(stageId: string, updates: Partial<Pick<Stage, "left_at" | "output_artifacts">>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.left_at !== undefined) {
      sets.push("left_at = ?");
      params.push(updates.left_at);
    }
    if (updates.output_artifacts !== undefined) {
      sets.push("output_artifacts = ?");
      params.push(JSON.stringify(updates.output_artifacts));
    }
    if (sets.length === 0) return;
    params.push(stageId);
    this.db.run(`UPDATE stage SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }
}

export class SQLiteRoleSnailAssignmentRepository implements RoleSnailAssignmentRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(ISSUE_SCHEMA);
  }

  append(session: RoleSnailAssignment): void {
    this.db.run(
      `INSERT INTO role_snail_assignment (stage_id, role_instance, seq, snail_key, snail_instance_id, role_key, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.stage_id,
        session.role_instance,
        session.seq,
        session.snail_key,
        session.snail_instance_id,
        session.role_key,
        session.description,
        session.created_at,
      ],
    );
  }

  getLatest(stageId: string, roleInstance: string): RoleSnailAssignment | null {
    return this.db.get<RoleSnailAssignmentRow>(
      `SELECT * FROM role_snail_assignment
       WHERE stage_id = ? AND role_instance = ?
       ORDER BY seq DESC
       LIMIT 1`,
      [stageId, roleInstance],
    ) ?? null;
  }

  listLatestByStage(stageId: string): RoleSnailAssignment[] {
    return this.db.all<RoleSnailAssignmentRow>(
      `SELECT rsa.*
       FROM role_snail_assignment rsa
       JOIN (
         SELECT role_instance, MAX(seq) AS max_seq
         FROM role_snail_assignment
         WHERE stage_id = ?
         GROUP BY role_instance
       ) latest ON latest.role_instance = rsa.role_instance AND latest.max_seq = rsa.seq
       WHERE rsa.stage_id = ?
       ORDER BY rsa.created_at ASC, rsa.role_instance ASC`,
      [stageId, stageId],
    );
  }

  setSnailInstanceId(stageId: string, roleInstance: string, snailInstanceId: string): void {
    const latest = this.getLatest(stageId, roleInstance);
    if (!latest) throw new Error(`RoleSnailAssignment not found: ${stageId}:${roleInstance}`);
    this.db.run(
      `UPDATE role_snail_assignment
       SET snail_instance_id = ?
       WHERE stage_id = ? AND role_instance = ? AND seq = ?`,
      [snailInstanceId, stageId, roleInstance, latest.seq],
    );
  }
}

function mapIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    workspace_path: row.workspace_path,
    title: row.title,
    summary: row.summary,
    sop_snapshot: JSON.parse(row.sop_snapshot),
    snail_assignment_plan: JSON.parse(row.snail_assignment_plan),
    extendable_context: JSON.parse(row.extendable_context),
    context: JSON.parse(row.context),
    created_at: row.created_at,
    closed_at: row.closed_at,
  };
}

function mapStage(row: StageRow): Stage {
  return {
    id: row.id,
    workspace_path: row.workspace_path,
    issue_id: row.issue_id,
    key: row.key,
    title: row.title,
    description: row.description,
    default_role_instance: row.default_role_instance,
    role_instances: JSON.parse(row.role_instances),
    from_stage_id: row.from_stage_id,
    available_transitions: JSON.parse(row.available_transitions),
    output_artifacts: JSON.parse(row.output_artifacts),
    entered_at: row.entered_at,
    left_at: row.left_at,
  };
}
