import Database from "better-sqlite3";
import path from "path";
import type { IssueMCPPort } from "@domain/snail-mcp-server/issue-port";
import type { Issue, Stage } from "@domain/issue/model";
import { IssueHistoryAdapter } from "@domain/snail-mcp-server/_internal/issue-history-adapter";

/**
 * Issue MCP 适配器实现。
 * 直接访问数据库，实现 IssueMCPPort 接口。
 * 继承 IssueHistoryAdapter 复用对话历史查询功能。
 */
export class IssueMCPPortAdapter extends IssueHistoryAdapter implements IssueMCPPort {
  constructor(repoRoot: string) {
    const dbPath = path.join(repoRoot, "data", "database", "snail-shell.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    super(db);
  }

  // ── Stage 操作 ──────────────────────────────────────────

  async recordStageContext(
    stageId: string,
    entries: Record<string, unknown>
  ): Promise<{ ok: true; stage_id: string; output_artifacts: Record<string, unknown> }> {
    const stageRow = this.db.prepare("SELECT * FROM stage WHERE id = ?").get(stageId) as any;
    if (!stageRow) throw new Error(`Stage not found: ${stageId}`);

    const issue = this.db.prepare("SELECT * FROM issue WHERE id = ?").get(stageRow.issue_id) as Issue | undefined;
    if (!issue) throw new Error(`Issue not found: ${stageRow.issue_id}`);
    if (issue.closed_at) throw new Error("Archived issue is read-only");

    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(stageRow.output_artifacts || "{}");
    } catch (_) { /* ignore */ }

    const updated = { ...current, ...entries };
    this.db.prepare("UPDATE stage SET output_artifacts = ? WHERE id = ?").run(
      JSON.stringify(updated),
      stageId
    );

    return { ok: true, stage_id: stageId, output_artifacts: updated };
  }

  async getActiveStage(issueId: string): Promise<Stage | null> {
    const stage = this.db.prepare(
      "SELECT * FROM stage WHERE issue_id = ? AND left_at IS NULL ORDER BY entered_at DESC LIMIT 1"
    ).get(issueId) as Stage | undefined;
    return stage || null;
  }

  async listStagesForWorkdir(): Promise<Array<{ id: string; worktree_path: string | null }>> {
    const rows = this.db.prepare(
      "SELECT id, output_artifacts FROM stage WHERE output_artifacts IS NOT NULL AND output_artifacts != ''"
    ).all() as Array<{ id: string; output_artifacts: string }>;

    return rows
      .map((r) => {
        let artifacts: Record<string, unknown> = {};
        try {
          artifacts = JSON.parse(r.output_artifacts || "{}");
        } catch (_) { /* ignore */ }
        return { id: r.id, worktree_path: (artifacts.worktree_path as string) || null };
      })
      .filter((s) => s.worktree_path);
  }

  // ── Issue 操作 ──────────────────────────────────────────

  async setTaskAnchor(
    issueId: string,
    taskAnchor: string
  ): Promise<{ ok: true; issue_id: string; task_anchor: string }> {
    const issue = this.db.prepare("SELECT * FROM issue WHERE id = ?").get(issueId) as Issue | undefined;
    if (!issue) throw new Error(`Issue not found: ${issueId}`);
    if (issue.closed_at) throw new Error("Archived issue is read-only");

    this.db.prepare("UPDATE issue SET task_anchor = ?, updated_at = datetime('now') WHERE id = ?").run(
      taskAnchor,
      issueId
    );

    return { ok: true, issue_id: issueId, task_anchor: taskAnchor };
  }

  // ── Context 查询 ──────────────────────────────────────────

  async queryContext(conversationId: string): Promise<{
    conv: {
      id: string;
      issue_id: string | null;
      stage_id: string | null;
      workspace_id: string | null;
      title: string | null;
      kind: string | null;
      summary: string | null;
      participating_roles: string[];
      from_conversation_ids: string[];
      created_at: string;
    };
    stage: Stage | null;
    stageDef: {
      id: string;
      key: string;
      title: string;
      description: string | null;
      input_description: string | null;
      output_description: string | null;
      acceptance_focus: string[];
    } | null;
    stageRoles: Array<{
      id: string;
      name: string;
      description: string | null;
      working_rules: string[];
    }>;
    issue: Issue | null;
    workspace: {
      id: string;
      name: string;
      summary: string | null;
    } | null;
    inputArtifacts: Record<string, unknown>;
  }> {
    const conv = this.db.prepare("SELECT * FROM conversation WHERE id = ?").get(conversationId) as any;
    if (!conv) throw new Error(`Conversation not found: ${conversationId}`);

    const { stage, stageDef, stageRoles, inputArtifacts } = this.resolveStageContext(conv);
    const issue = this.resolveIssue(conv.issue_id);
    const workspace = this.resolveWorkspace(conv.workspace_id);

    return {
      conv: this.formatConversation(conv),
      stage,
      stageDef,
      stageRoles,
      issue,
      workspace,
      inputArtifacts,
    };
  }

  private resolveStageContext(conv: any): {
    stage: Stage | null;
    stageDef: any;
    stageRoles: any[];
    inputArtifacts: Record<string, unknown>;
  } {
    let stage: Stage | null = null;
    let stageDef: any = null;
    let stageRoles: any[] = [];
    let inputArtifacts: Record<string, unknown> = {};

    if (!conv.stage_id) {
      return { stage, stageDef, stageRoles, inputArtifacts };
    }

    stage = this.db.prepare("SELECT * FROM stage WHERE id = ?").get(conv.stage_id) as Stage | undefined || null;
    if (!stage) {
      return { stage, stageDef, stageRoles, inputArtifacts };
    }

    const stageContext = this.buildStageDefinition(stage);
    stageDef = stageContext.stageDef;
    stageRoles = stageContext.stageRoles;

    inputArtifacts = this.resolveInputArtifacts(stage);

    return { stage, stageDef, stageRoles, inputArtifacts };
  }

  private buildStageDefinition(stage: Stage): { stageDef: any; stageRoles: any[] } {
    const issue = this.db.prepare("SELECT * FROM issue WHERE id = ?").get(stage.issue_id) as Issue | undefined;
    if (!issue?.sop_snapshot) {
      return { stageDef: null, stageRoles: [] };
    }

    const sopSnapshot = typeof issue.sop_snapshot === 'string'
      ? JSON.parse(issue.sop_snapshot)
      : issue.sop_snapshot;

    if (!sopSnapshot.stages) {
      return { stageDef: null, stageRoles: [] };
    }

    const stageDef = sopSnapshot.stages.find((s: any) => s.key === stage.key) || null;
    const stageRoles = stageDef?.roles || [];

    return { stageDef, stageRoles };
  }

  private resolveInputArtifacts(stage: Stage): Record<string, unknown> {
    if (!stage.from_stage_id) {
      return {};
    }

    const prevStageRow = this.db.prepare(
      "SELECT * FROM stage WHERE id = ?"
    ).get(stage.from_stage_id) as any;

    if (!prevStageRow) {
      return {};
    }

    try {
      return JSON.parse(prevStageRow.output_artifacts || "{}");
    } catch (_) {
      return {};
    }
  }

  private resolveIssue(issueId: string | null): Issue | null {
    if (!issueId) {
      return null;
    }
    return this.db.prepare("SELECT * FROM issue WHERE id = ?").get(issueId) as Issue | undefined || null;
  }

  private resolveWorkspace(workspaceId: string | null): { id: string; name: string; summary: string | null } | null {
    if (!workspaceId) {
      return null;
    }
    return { id: workspaceId, name: workspaceId, summary: null };
  }

  private formatConversation(conv: any): any {
    let participatingRoles: string[] = [];
    let fromConversationIds: string[] = [];
    try { participatingRoles = JSON.parse(conv.participating_roles || "[]"); } catch (_) { /* ignore */ }
    try { fromConversationIds = JSON.parse(conv.from_conversation_ids || "[]"); } catch (_) { /* ignore */ }

    return {
      id: conv.id,
      issue_id: conv.issue_id,
      stage_id: conv.stage_id,
      workspace_id: conv.workspace_id,
      title: conv.title,
      kind: conv.kind,
      summary: conv.summary,
      participating_roles: participatingRoles,
      from_conversation_ids: fromConversationIds,
      created_at: conv.created_at,
    };
  }

  /** 关闭数据库连接 */
  close(): void {
    try {
      this.db.close();
    } catch (_) { /* ignore */ }
  }
}
