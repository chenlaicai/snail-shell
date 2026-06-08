import type Database from 'better-sqlite3';
import type {
  EvolutionItem,
  EvolutionItemType,
  EvolutionItemStatus,
  KnowledgeEntry,
  KnowledgeScope,
} from '@/evolution/types.js';

export class EvolutionRepo {
  constructor(private db: Database.Database) {}

  // ─── EvolutionItem ───

  getEvolutionItemById(id: string): EvolutionItem | undefined {
    const row = this.db.prepare('SELECT * FROM evolution_item WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.parseEvolutionItem(row) : undefined;
  }

  listEvolutionItemsByWorkspace(workspaceId: string, options?: { status?: EvolutionItemStatus }): EvolutionItem[] {
    let sql = 'SELECT * FROM evolution_item WHERE workspace_id = ?';
    const params: unknown[] = [workspaceId];
    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    sql += ' ORDER BY updated_at DESC';
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[])
      .map(row => this.parseEvolutionItem(row));
  }

  createEvolutionItem(item: EvolutionItem): void {
    this.db.prepare(`
      INSERT INTO evolution_item (id, workspace_id, issue_id, type, status, title, content, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.workspace_id,
      item.issue_id ?? null,
      item.type,
      item.status,
      item.title,
      item.content,
      JSON.stringify(item.tags),
      item.created_at,
      item.updated_at,
    );
  }

  updateEvolutionItemStatus(id: string, status: EvolutionItemStatus): void {
    this.db.prepare('UPDATE evolution_item SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
  }

  // ─── KnowledgeEntry ───

  getKnowledgeEntryById(id: string): KnowledgeEntry | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_entry WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.parseKnowledgeEntry(row) : undefined;
  }

  listKnowledgeEntries(options?: { scope?: KnowledgeScope; workspaceId?: string }): KnowledgeEntry[] {
    let sql = 'SELECT * FROM knowledge_entry WHERE 1=1';
    const params: unknown[] = [];
    if (options?.scope) {
      sql += ' AND scope = ?';
      params.push(options.scope);
    }
    if (options?.workspaceId) {
      sql += ' AND (workspace_id = ? OR scope = \'global\')';
      params.push(options.workspaceId);
    }
    sql += ' ORDER BY updated_at DESC';
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[])
      .map(row => this.parseKnowledgeEntry(row));
  }

  createKnowledgeEntry(entry: KnowledgeEntry): void {
    this.db.prepare(`
      INSERT INTO knowledge_entry (id, workspace_id, scope, title, content, source_evolution_id, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.workspace_id ?? null,
      entry.scope,
      entry.title,
      entry.content,
      entry.source_evolution_id ?? null,
      JSON.stringify(entry.tags),
      entry.created_at,
      entry.updated_at,
    );
  }

  // ─── 解析 ───

  private parseEvolutionItem(row: Record<string, unknown>): EvolutionItem {
    return {
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      issue_id: row.issue_id as string | undefined,
      type: row.type as EvolutionItemType,
      status: row.status as EvolutionItemStatus,
      title: row.title as string,
      content: row.content as string,
      tags: JSON.parse(row.tags as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private parseKnowledgeEntry(row: Record<string, unknown>): KnowledgeEntry {
    return {
      id: row.id as string,
      workspace_id: row.workspace_id as string | undefined,
      scope: row.scope as KnowledgeScope,
      title: row.title as string,
      content: row.content as string,
      source_evolution_id: row.source_evolution_id as string | undefined,
      tags: JSON.parse(row.tags as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
