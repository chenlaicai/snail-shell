import type Database from 'better-sqlite3';
import type { Issue, Stage, StageStatus } from '@/issue/types.js';

export class IssueRepo {
  constructor(private db: Database.Database) {}

  // ─── Issue ───

  getById(id: string): Issue | undefined {
    const row = this.db.prepare('SELECT * FROM issue WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.parseIssue(row) : undefined;
  }

  listByWorkspace(workspaceId: string, options?: { includeClosed?: boolean }): Issue[] {
    const sql = options?.includeClosed
      ? 'SELECT * FROM issue WHERE workspace_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM issue WHERE workspace_id = ? AND closed_at IS NULL ORDER BY created_at DESC';
    return (this.db.prepare(sql).all(workspaceId) as Record<string, unknown>[]).map(row => this.parseIssue(row));
  }

  create(issue: Issue): void {
    this.db.prepare(`
      INSERT INTO issue (id, workspace_id, title, summary, task_anchor, sop_snapshot, role_snail_mapping, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      issue.id,
      issue.workspace_id,
      issue.title,
      issue.summary ?? null,
      issue.task_anchor ? JSON.stringify(issue.task_anchor) : null,
      JSON.stringify(issue.sop_snapshot),
      JSON.stringify(issue.role_snail_mapping),
      issue.created_at,
      issue.updated_at,
    );
  }

  close(id: string, closedAt: string): void {
    this.db.prepare('UPDATE issue SET closed_at = ?, updated_at = datetime(\'now\') WHERE id = ?').run(closedAt, id);
  }

  // ─── Stage ───

  getStageById(id: string): Stage | undefined {
    const row = this.db.prepare('SELECT * FROM stage WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.parseStage(row) : undefined;
  }

  listStagesByIssue(issueId: string): Stage[] {
    return (this.db.prepare('SELECT * FROM stage WHERE issue_id = ? ORDER BY sequence').all(issueId) as Record<string, unknown>[])
      .map(row => this.parseStage(row));
  }

  createStage(stage: Stage): void {
    this.db.prepare(`
      INSERT INTO stage (id, workspace_id, issue_id, stage_definition_id, type, sequence, status, output_artifacts, gate_evidence, entered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stage.id,
      stage.workspace_id,
      stage.issue_id,
      stage.stage_definition_id,
      stage.type,
      stage.sequence,
      stage.status,
      stage.output_artifacts ? JSON.stringify(stage.output_artifacts) : null,
      stage.gate_evidence ? JSON.stringify(stage.gate_evidence) : null,
      stage.entered_at,
    );
  }

  updateStageStatus(id: string, status: StageStatus, leftAt?: string): void {
    this.db.prepare('UPDATE stage SET status = ?, left_at = ? WHERE id = ?').run(status, leftAt ?? null, id);
  }

  updateStageArtifacts(id: string, artifacts: Record<string, unknown>): void {
    this.db.prepare('UPDATE stage SET output_artifacts = ? WHERE id = ?').run(JSON.stringify(artifacts), id);
  }

  updateStageGateEvidence(id: string, evidence: unknown): void {
    this.db.prepare('UPDATE stage SET gate_evidence = ? WHERE id = ?').run(JSON.stringify(evidence), id);
  }

  // ─── 解析 ───

  private parseIssue(row: Record<string, unknown>): Issue {
    return {
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      title: row.title as string,
      summary: row.summary as string | undefined,
      task_anchor: row.task_anchor ? JSON.parse(row.task_anchor as string) : undefined,
      sop_snapshot: JSON.parse(row.sop_snapshot as string),
      role_snail_mapping: JSON.parse(row.role_snail_mapping as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      closed_at: row.closed_at as string | undefined,
    };
  }

  private parseStage(row: Record<string, unknown>): Stage {
    return {
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      issue_id: row.issue_id as string,
      stage_definition_id: row.stage_definition_id as string,
      type: row.type as string,
      sequence: row.sequence as number,
      status: row.status as StageStatus,
      output_artifacts: row.output_artifacts ? JSON.parse(row.output_artifacts as string) : undefined,
      gate_evidence: row.gate_evidence ? JSON.parse(row.gate_evidence as string) : undefined,
      entered_at: row.entered_at as string,
      left_at: row.left_at as string | undefined,
    };
  }
}
