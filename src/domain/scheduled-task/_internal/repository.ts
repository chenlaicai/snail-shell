import type { SQLiteDatabase } from "@infra/database";
import type {
  ScheduledTask,
  ScheduledTaskExecution,
  ScheduledTaskWithLastExecution,
  UpdateScheduledTaskInput,
} from "@domain/scheduled-task/model";

const SCHEDULED_TASK_SCHEMA = `
CREATE TABLE IF NOT EXISTS scheduled_task (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  sop_key TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  interval_days REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_task_execution (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES scheduled_task(id) ON DELETE CASCADE,
  issue_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  executed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_task_execution_task ON scheduled_task_execution(task_id, executed_at DESC);
`;

/** 定时任务持久层接口 */
export interface ScheduledTaskRepository {
  findAll(): ScheduledTaskWithLastExecution[];
  findById(id: string): ScheduledTask | undefined;
  findByKey(key: string): ScheduledTask | undefined;
  create(task: ScheduledTask): void;
  update(id: string, updates: UpdateScheduledTaskInput & { updated_at: string }): void;
  remove(id: string): void;
  findPendingExecutions(): ScheduledTask[];
  findLastExecution(taskId: string): ScheduledTaskExecution | undefined;
  listExecutions(taskId: string): ScheduledTaskExecution[];
  createExecution(execution: ScheduledTaskExecution): void;
  updateExecutionStatus(id: string, status: ScheduledTaskExecution["status"], error: string | null): void;
}

/** 定时任务 SQLite 存储实现 */
export class SQLiteScheduledTaskRepository implements ScheduledTaskRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(SCHEDULED_TASK_SCHEMA);
  }

  findAll(): ScheduledTaskWithLastExecution[] {
    return this.db.all<RawTaskWithLastExecRow>(
      `SELECT t.id, t.key, t.title, t.sop_key, t.workspace_path, t.interval_days,
              t.enabled as enabled_raw, t.created_at, t.updated_at,
              e.status as last_status, e.issue_id as last_issue_id
       FROM scheduled_task t
       LEFT JOIN scheduled_task_execution e
         ON e.id = (
           SELECT id FROM scheduled_task_execution
           WHERE task_id = t.id
           ORDER BY executed_at DESC LIMIT 1
         )
       ORDER BY t.created_at DESC`,
    ).map((row) => ({
      ...mapTask(row),
      last_status: row.last_status ?? null,
      last_issue_id: row.last_issue_id ?? null,
    }));
  }

  findById(id: string): ScheduledTask | undefined {
    const row = this.db.get<RawTaskRow>(
      `SELECT id, key, title, sop_key, workspace_path, interval_days,
              enabled as enabled_raw, created_at, updated_at
       FROM scheduled_task WHERE id = ?`,
      [id],
    );
    return row ? mapTask(row) : undefined;
  }

  findByKey(key: string): ScheduledTask | undefined {
    const row = this.db.get<RawTaskRow>(
      `SELECT id, key, title, sop_key, workspace_path, interval_days,
              enabled as enabled_raw, created_at, updated_at
       FROM scheduled_task WHERE key = ?`,
      [key],
    );
    return row ? mapTask(row) : undefined;
  }

  create(task: ScheduledTask): void {
    this.db.run(
      `INSERT INTO scheduled_task (id, key, title, sop_key, workspace_path, interval_days, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [task.id, task.key, task.title, task.sop_key, task.workspace_path, task.interval_days, task.enabled ? 1 : 0, task.created_at, task.updated_at],
    );
  }

  update(id: string, updates: UpdateScheduledTaskInput & { updated_at: string }): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.title !== undefined) { sets.push("title = ?"); params.push(updates.title); }
    if (updates.sop_key !== undefined) { sets.push("sop_key = ?"); params.push(updates.sop_key); }
    if (updates.workspace_path !== undefined) { sets.push("workspace_path = ?"); params.push(updates.workspace_path); }
    if (updates.interval_days !== undefined) { sets.push("interval_days = ?"); params.push(updates.interval_days); }
    if (updates.enabled !== undefined) { sets.push("enabled = ?"); params.push(updates.enabled ? 1 : 0); }
    sets.push("updated_at = ?");
    params.push(updates.updated_at);
    params.push(id);
    this.db.run(`UPDATE scheduled_task SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  remove(id: string): void {
    this.db.run(`DELETE FROM scheduled_task WHERE id = ?`, [id]);
  }

  findPendingExecutions(): ScheduledTask[] {
    /** 查找所有 enabled=true 的任务，供调度器评估 */
    const rows = this.db.all<RawTaskRow>(
      `SELECT id, key, title, sop_key, workspace_path, interval_days,
              enabled as enabled_raw, created_at, updated_at
       FROM scheduled_task WHERE enabled = 1`,
    );
    return rows.map(mapTask);
  }

  findLastExecution(taskId: string): ScheduledTaskExecution | undefined {
    return this.db.get<ScheduledTaskExecution>(
      `SELECT id, task_id, issue_id, status, error, executed_at
       FROM scheduled_task_execution WHERE task_id = ? ORDER BY executed_at DESC LIMIT 1`,
      [taskId],
    );
  }

  listExecutions(taskId: string): ScheduledTaskExecution[] {
    return this.db.all<ScheduledTaskExecution>(
      `SELECT id, task_id, issue_id, status, error, executed_at
       FROM scheduled_task_execution WHERE task_id = ? ORDER BY executed_at DESC`,
      [taskId],
    );
  }

  createExecution(execution: ScheduledTaskExecution): void {
    this.db.run(
      `INSERT INTO scheduled_task_execution (id, task_id, issue_id, status, error, executed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [execution.id, execution.task_id, execution.issue_id, execution.status, execution.error, execution.executed_at],
    );
  }

  updateExecutionStatus(id: string, status: ScheduledTaskExecution["status"], error: string | null): void {
    this.db.run(
      `UPDATE scheduled_task_execution SET status = ?, error = ? WHERE id = ?`,
      [status, error, id],
    );
  }
}

/** SQLite 返回的原始行类型（enabled 存为 integer） */
interface RawTaskRow {
  id: string;
  key: string;
  title: string;
  sop_key: string;
  workspace_path: string;
  interval_days: number;
  enabled_raw: number;
  created_at: string;
  updated_at: string;
}

/** JOIN 查询返回的行类型（含最近执行状态） */
interface RawTaskWithLastExecRow extends RawTaskRow {
  last_status: ScheduledTaskExecution["status"] | null;
  last_issue_id: string | null;
}

/** 映射 SQLite 行到 ScheduledTask（处理 boolean 转换） */
function mapTask(row: RawTaskRow): ScheduledTask {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    sop_key: row.sop_key,
    workspace_path: row.workspace_path,
    interval_days: row.interval_days,
    enabled: row.enabled_raw === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
