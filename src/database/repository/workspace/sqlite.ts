/**
 * SQLite Workspace Repository 实现
 *
 * 基于 better-sqlite3 实现 Workspace Repository 接口。
 */

import type { DatabaseConnection } from "../../connection/types";
import type {
  WorkspaceRepository,
  Workspace,
  Issue,
  Stage,
  CreateWorkspaceInput,
  CreateIssueInput,
  CreateStageInput,
  StageStatus,
} from "./types";

/**
 * SQLite Workspace Repository 实现
 */
export class SqliteWorkspaceRepository implements WorkspaceRepository {
  constructor(private connection: DatabaseConnection) {}

  // ═══ Workspace CRUD ═══

  async getWorkspace(id: string): Promise<Workspace | null> {
    const result = await this.connection.query<Workspace>(
      "SELECT * FROM workspace WHERE id = ?",
      [id]
    );
    return result.rows[0] ?? null;
  }

  async listWorkspaces(limit = 50, offset = 0): Promise<Workspace[]> {
    const result = await this.connection.query<Workspace>(
      "SELECT * FROM workspace ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [limit, offset]
    );
    return result.rows;
  }

  async saveWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    await this.connection.execute(
      `INSERT INTO workspace (id, name, summary, workspace_root)
       VALUES (?, ?, ?, ?)`,
      [input.id, input.name, input.summary ?? null, input.workspace_root]
    );

    const workspace = await this.getWorkspace(input.id);
    if (!workspace) {
      throw new Error("Failed to save workspace");
    }
    return workspace;
  }

  // ═══ Issue CRUD ═══

  async getIssue(id: string): Promise<Issue | null> {
    const result = await this.connection.query<Issue>(
      "SELECT * FROM issue WHERE id = ?",
      [id]
    );
    if (result.rows[0]) {
      return {
        ...result.rows[0],
        sop_snapshot: JSON.parse(result.rows[0].sop_snapshot as unknown as string),
        role_snail_mapping: JSON.parse(result.rows[0].role_snail_mapping as unknown as string),
      };
    }
    return null;
  }

  async listIssues(workspaceId: string): Promise<Issue[]> {
    const result = await this.connection.query<Issue>(
      "SELECT * FROM issue WHERE workspace_id = ? ORDER BY updated_at DESC",
      [workspaceId]
    );
    return result.rows.map((row) => ({
      ...row,
      sop_snapshot: JSON.parse(row.sop_snapshot as unknown as string),
      role_snail_mapping: JSON.parse(row.role_snail_mapping as unknown as string),
    }));
  }

  async saveIssue(input: CreateIssueInput): Promise<Issue> {
    await this.connection.execute(
      `INSERT INTO issue (id, workspace_id, title, summary, task_anchor, sop_snapshot, role_snail_mapping)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.workspace_id,
        input.title,
        input.summary ?? null,
        input.task_anchor ?? null,
        JSON.stringify(input.sop_snapshot ?? {}),
        JSON.stringify(input.role_snail_mapping ?? {}),
      ]
    );

    const issue = await this.getIssue(input.id);
    if (!issue) {
      throw new Error("Failed to save issue");
    }
    return issue;
  }

  async updateIssue(id: string, updates: Partial<Issue>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push("title = ?");
      values.push(updates.title);
    }
    if (updates.summary !== undefined) {
      fields.push("summary = ?");
      values.push(updates.summary);
    }
    if (updates.task_anchor !== undefined) {
      fields.push("task_anchor = ?");
      values.push(updates.task_anchor);
    }
    if (updates.sop_snapshot !== undefined) {
      fields.push("sop_snapshot = ?");
      values.push(JSON.stringify(updates.sop_snapshot));
    }
    if (updates.role_snail_mapping !== undefined) {
      fields.push("role_snail_mapping = ?");
      values.push(JSON.stringify(updates.role_snail_mapping));
    }
    if (updates.closed_at !== undefined) {
      fields.push("closed_at = ?");
      values.push(updates.closed_at);
    }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      await this.connection.execute(
        `UPDATE issue SET ${fields.join(", ")} WHERE id = ?`,
        values
      );
    }
  }

  // ═══ Stage CRUD ═══

  async getStage(id: string): Promise<Stage | null> {
    const result = await this.connection.query<Stage>(
      "SELECT * FROM stage WHERE id = ?",
      [id]
    );
    if (result.rows[0]) {
      return {
        ...result.rows[0],
        output_artifacts: JSON.parse(result.rows[0].output_artifacts as unknown as string),
      };
    }
    return null;
  }

  async listStages(issueId: string): Promise<Stage[]> {
    const result = await this.connection.query<Stage>(
      "SELECT * FROM stage WHERE issue_id = ? ORDER BY sequence ASC",
      [issueId]
    );
    return result.rows.map((row) => ({
      ...row,
      output_artifacts: JSON.parse(row.output_artifacts as unknown as string),
    }));
  }

  async saveStage(input: CreateStageInput): Promise<Stage> {
    await this.connection.execute(
      `INSERT INTO stage (id, workspace_id, issue_id, stage_definition_id, type, sequence, status, output_artifacts, gate_evidence, entered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.workspace_id,
        input.issue_id,
        input.stage_definition_id,
        input.type,
        input.sequence,
        input.status ?? "in_progress",
        JSON.stringify(input.output_artifacts ?? {}),
        input.gate_evidence ?? null,
        input.entered_at ?? new Date().toISOString(),
      ]
    );

    const stage = await this.getStage(input.id);
    if (!stage) {
      throw new Error("Failed to save stage");
    }
    return stage;
  }

  async updateStageStatus(id: string, status: StageStatus): Promise<void> {
    await this.connection.execute(
      `UPDATE stage SET status = ?, left_at = CASE WHEN ? IN ('completed', 'cancelled') THEN datetime('now') ELSE left_at END WHERE id = ?`,
      [status, status, id]
    );
  }

  // ═══ 查询方法 ═══

  async findWorkspaceByName(name: string): Promise<Workspace | null> {
    const result = await this.connection.query<Workspace>(
      "SELECT * FROM workspace WHERE name = ?",
      [name]
    );
    return result.rows[0] ?? null;
  }

  async getIssueStages(issueId: string): Promise<Stage[]> {
    return this.listStages(issueId);
  }
}
