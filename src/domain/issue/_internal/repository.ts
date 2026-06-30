import type { SQLiteDatabase } from "@infra/database";
import type { Issue, Stage, RoleSnailAssignment, IssueAggregateStatus, AggregatedProgress } from "@domain/issue/model";
import type { StageAuditRecord } from "@domain/issue/port";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "issue-repository" });

// ── Issue Repository ──────────────────────────────────────────────────

export interface IssueRepository {
  findById(id: string): Issue | undefined;
  listByWorkspace(workspacePath: string, limit?: number, offset?: number): Issue[];
  create(issue: Issue): void;
  /** 更新 Issue 上下文（merge 语义） */
  updateContext(issueId: string, context: Record<string, string>): void;
  updateClosedAt(id: string, closedAt: string): void;
  /** 查找所有直接子 issue */
  listChildren(parentIssueId: string): Issue[];
  /** 添加子 issue ID 到父 issue */
  addChildIssue(parentIssueId: string, childIssueId: string): void;
  /** 更新聚合状态和进度 */
  updateAggregatedStatus(issueId: string, status: IssueAggregateStatus, progress: AggregatedProgress): void;
}


// ── Stage Repository ──────────────────────────────────────────────────

export interface StageRepository {
  findById(id: string): Stage | undefined;
  listByIssue(issueId: string): Stage[];
  findActiveByIssue(issueId: string): Stage | undefined;
  /** 返回 issue 未关闭的 stage ID 子集（单次 JOIN 查询） */
  listOpenStageIds(stageIds: string[]): string[];
  /** 返回所有 open stage ID（left_at IS NULL 且 issue 未 closed） */
  listAllOpenStageIds(): string[];
  create(stage: Stage): void;
  update(stageId: string, updates: Partial<Pick<Stage, "left_at" | "output_artifacts">>): void;
  /** 回退到指定 Stage */
  rollbackStage(currentStageId: string, targetKey: string): Stage;
  /** 记录审计轨迹 */
  recordAudit(audit: StageAuditRecord): void;
  /** 获取审计轨迹 */
  getAuditTrail(stageId: string): StageAuditRecord[];
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
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  closed_at TEXT,
  parent_issue_id TEXT,
  child_issue_ids TEXT NOT NULL DEFAULT '[]',
  issue_type TEXT NOT NULL DEFAULT 'task',
  aggregated_status TEXT NOT NULL DEFAULT 'pending',
  aggregated_progress TEXT NOT NULL DEFAULT '{"total":0,"completed":0,"in_progress":0,"failed":0,"blocked":0}'
);

CREATE INDEX IF NOT EXISTS idx_issue_workspace_created ON issue(workspace_path, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_parent ON issue(parent_issue_id);

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

CREATE TABLE IF NOT EXISTS stage_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id TEXT NOT NULL,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  trigger TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  consensus_content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stage_audit_stage ON stage_audit(stage_id);
`;

type IssueRow = {
  id: string;
  workspace_path: string;
  title: string;
  summary: string | null;
  sop_snapshot: string;
  snail_assignment_plan: string;
  context: string;
  created_at: string;
  closed_at: string | null;
  parent_issue_id: string | null;
  child_issue_ids: string;
  issue_type: string;
  aggregated_status: string;
  aggregated_progress: string;
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
      `INSERT INTO issue (id, workspace_path, title, summary, sop_snapshot, snail_assignment_plan, context, created_at, closed_at, parent_issue_id, child_issue_ids, issue_type, aggregated_status, aggregated_progress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        issue.id,
        issue.workspace_path,
        issue.title,
        issue.summary,
        JSON.stringify(issue.sop_snapshot),
        JSON.stringify(issue.snail_assignment_plan),
        JSON.stringify(issue.context),
        issue.created_at,
        issue.closed_at,
        issue.parent_issue_id,
        JSON.stringify(issue.child_issue_ids),
        issue.issue_type,
        issue.aggregated_status,
        JSON.stringify(issue.aggregated_progress),
      ],
    );
  }

  updateContext(issueId: string, context: Record<string, string>): void {
    this.db.run(
      `UPDATE issue SET context = ? WHERE id = ?`,
      [JSON.stringify(context), issueId],
    );
  }

  updateClosedAt(id: string, closedAt: string): void {
    this.db.run(`UPDATE issue SET closed_at = ? WHERE id = ?`, [closedAt, id]);
  }

  listChildren(parentIssueId: string): Issue[] {
    return this.db.all<IssueRow>(
      `SELECT * FROM issue WHERE parent_issue_id = ? ORDER BY created_at ASC`,
      [parentIssueId],
    ).map(mapIssue);
  }

  addChildIssue(parentIssueId: string, childIssueId: string): void {
    const issue = this.findById(parentIssueId);
    if (!issue) throw new Error(`Issue not found: ${parentIssueId}`);
    const childIds = [...issue.child_issue_ids, childIssueId];
    this.db.run(
      `UPDATE issue SET child_issue_ids = ? WHERE id = ?`,
      [JSON.stringify(childIds), parentIssueId],
    );
  }

  updateAggregatedStatus(issueId: string, status: IssueAggregateStatus, progress: AggregatedProgress): void {
    this.db.run(
      `UPDATE issue SET aggregated_status = ?, aggregated_progress = ? WHERE id = ?`,
      [status, JSON.stringify(progress), issueId],
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

  findActiveByIssue(issueId: string): Stage | undefined {
    const row = this.db.get<StageRow>(
      `SELECT * FROM stage WHERE issue_id = ? AND left_at IS NULL LIMIT 1`,
      [issueId],
    );
    return row ? mapStage(row) : undefined;
  }

  listOpenStageIds(stageIds: string[]): string[] {
    if (stageIds.length === 0) return [];
    const results: string[] = [];
    const BATCH_SIZE = 500;
    for (let i = 0; i < stageIds.length; i += BATCH_SIZE) {
      const batch = stageIds.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(",");
      const rows = this.db.all<{ id: string }>(
        `SELECT s.id FROM stage s JOIN issue i ON i.id = s.issue_id WHERE s.id IN (${placeholders}) AND i.closed_at IS NULL`,
        batch,
      );
      for (const row of rows) results.push(row.id);
    }
    return results;
  }

  listAllOpenStageIds(): string[] {
    return this.db.all<{ id: string }>(
      `SELECT s.id FROM stage s JOIN issue i ON i.id = s.issue_id WHERE s.left_at IS NULL AND i.closed_at IS NULL`,
    ).map(row => row.id);
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

  rollbackStage(currentStageId: string, targetKey: string): Stage {
    return this.transaction(() => {
      const current = this.findById(currentStageId);
      if (!current) throw new Error(`Stage not found: ${currentStageId}`);

      if (!current.from_stage_id) {
        throw new Error(`Cannot rollback: stage ${currentStageId} has no previous stage`);
      }

      const previousStage = this.findById(current.from_stage_id);
      if (!previousStage) {
        throw new Error(`Cannot rollback: previous stage ${current.from_stage_id} not found`);
      }

      if (previousStage.key !== targetKey) {
        throw new Error(`Cannot rollback: previous stage key "${previousStage.key}" does not match target "${targetKey}"`);
      }

      // 清理当前 stage 的关联数据
      this.db.run(`DELETE FROM role_snail_assignment WHERE stage_id = ?`, [currentStageId]);
      this.db.run(`DELETE FROM stage_audit WHERE stage_id = ?`, [currentStageId]);
      this.db.run(`DELETE FROM stage WHERE id = ?`, [currentStageId]);

      // 清除前一个 stage 的 left_at
      this.db.run(`UPDATE stage SET left_at = NULL WHERE id = ?`, [previousStage.id]);

      const updated = this.findById(previousStage.id);
      if (!updated) throw new Error(`Stage not found after rollback: ${previousStage.id}`);

      log.info({ fromStageId: currentStageId, toStageId: previousStage.id, targetKey }, "stage.rollback");
      return updated;
    });
  }

  recordAudit(audit: StageAuditRecord): void {
    this.db.run(
      `INSERT INTO stage_audit (stage_id, from_key, to_key, trigger, trigger_reason, consensus_content, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [audit.stage_id, audit.from_key, audit.to_key, audit.trigger, audit.trigger_reason, audit.consensus_content, audit.timestamp]
    );
  }

  getAuditTrail(stageId: string): StageAuditRecord[] {
    return this.db.all<StageAuditRecord>(
      `SELECT * FROM stage_audit WHERE stage_id = ? ORDER BY timestamp ASC`,
      [stageId]
    );
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
    context: JSON.parse(row.context),
    created_at: row.created_at,
    closed_at: row.closed_at,
    parent_issue_id: row.parent_issue_id,
    child_issue_ids: JSON.parse(row.child_issue_ids),
    issue_type: row.issue_type as "project" | "task",
    aggregated_status: row.aggregated_status as IssueAggregateStatus,
    aggregated_progress: JSON.parse(row.aggregated_progress),
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
