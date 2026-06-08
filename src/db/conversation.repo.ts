import type Database from 'better-sqlite3';
import type { Conversation, ConversationKind, ConversationStatus } from '@/conversation/types.js';

export class ConversationRepo {
  constructor(private db: Database.Database) {}

  getById(id: string): Conversation | undefined {
    const row = this.db.prepare('SELECT * FROM conversation WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.parse(row) : undefined;
  }

  getByStageId(stageId: string): Conversation | undefined {
    const row = this.db.prepare('SELECT * FROM conversation WHERE stage_id = ?').get(stageId) as Record<string, unknown> | undefined;
    return row ? this.parse(row) : undefined;
  }

  listByIssue(issueId: string): Conversation[] {
    return (this.db.prepare('SELECT * FROM conversation WHERE issue_id = ? ORDER BY created_at').all(issueId) as Record<string, unknown>[])
      .map(row => this.parse(row));
  }

  create(conversation: Conversation): void {
    this.db.prepare(`
      INSERT INTO conversation (id, workspace_id, issue_id, stage_id, title, kind, status, default_role, participating_roles, summary, from_conversation_ids, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversation.id,
      conversation.workspace_id,
      conversation.issue_id,
      conversation.stage_id,
      conversation.title ?? null,
      conversation.kind,
      conversation.status,
      conversation.default_role,
      JSON.stringify(conversation.participating_roles),
      conversation.summary ?? null,
      JSON.stringify(conversation.from_conversation_ids),
      conversation.created_at,
      conversation.updated_at,
    );
  }

  updateStatus(id: string, status: ConversationStatus): void {
    this.db.prepare('UPDATE conversation SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
  }

  updateSummary(id: string, summary: string): void {
    this.db.prepare('UPDATE conversation SET summary = ?, updated_at = datetime(\'now\') WHERE id = ?').run(summary, id);
  }

  private parse(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      issue_id: row.issue_id as string,
      stage_id: row.stage_id as string,
      title: row.title as string | undefined,
      kind: row.kind as ConversationKind,
      status: row.status as ConversationStatus,
      default_role: row.default_role as string,
      participating_roles: JSON.parse(row.participating_roles as string),
      summary: row.summary as string | undefined,
      from_conversation_ids: JSON.parse(row.from_conversation_ids as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
