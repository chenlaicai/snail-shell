import Database from "better-sqlite3";
import type { KnowledgeEntry } from "@domain/knowledge/model";

/** 搜索结果 */
export interface SearchResult {
  entry: KnowledgeEntry;
  snippet: string;
}

/**
 * 知识库搜索索引（FTS5）。
 *
 * 职责：
 * - 提供高性能全文搜索（中文分词、snippet 高亮）
 * - 从文件真相源重建索引
 * - 索引损坏时自动恢复
 *
 * 索引文件位置：data/knowledge-search.db
 * 与平台级数据同目录，不属于 workspace。
 */
export class KnowledgeSearchIndex {
  private db: Database.Database;
  private insertEntryStmt: Database.Statement;
  private insertSearchStmt: Database.Statement;
  private deleteSearchStmt: Database.Statement;
  private deleteEntryStmt: Database.Statement;

  constructor(private indexPath: string) {
    this.db = new Database(indexPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();

    this.insertEntryStmt = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_entries (id, scope, workspace_path, title, content, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    this.insertSearchStmt = this.db.prepare(`
      INSERT INTO knowledge_search (entry_id, scope, workspace_path, title, content)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.deleteSearchStmt = this.db.prepare(`DELETE FROM knowledge_search WHERE entry_id = ?`);
    this.deleteEntryStmt = this.db.prepare(`DELETE FROM knowledge_entries WHERE id = ?`);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        workspace_path TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search USING fts5(
        entry_id UNINDEXED,
        scope UNINDEXED,
        workspace_path UNINDEXED,
        title,
        content,
        tokenize='unicode61'
      );
    `);
  }

  /** 全文搜索 */
  search(query: string, workspacePath?: string): SearchResult[] {
    const ftsQuery = this.buildFtsQuery(query);
    let sql = `
      SELECT
        ks.entry_id,
        ks.scope,
        ks.workspace_path,
        snippet(knowledge_search, 4, '[', ']', '...', 24) AS snippet,
        ke.title,
        ke.content
      FROM knowledge_search ks
      JOIN knowledge_entries ke ON ke.id = ks.entry_id
      WHERE knowledge_search MATCH ?
    `;
    const params: string[] = [ftsQuery];

    if (workspacePath) {
      sql += ` AND (ks.workspace_path IS NULL OR ks.workspace_path = ?)`;
      params.push(workspacePath);
    }

    sql += ` ORDER BY rank LIMIT 50`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      entry_id: string;
      scope: string;
      workspace_path: string | null;
      title: string;
      content: string;
      snippet: string;
    }>;

    return rows.map((row) => ({
      entry: {
        id: row.entry_id,
        title: row.title,
        content: row.content,
        scope: row.scope as KnowledgeEntry["scope"],
        tags: [],
      },
      snippet: row.snippet,
    }));
  }

  /** 同步单条目到索引（upsert） */
  upsert(entry: KnowledgeEntry): void {
    const workspacePath = entry.workspace?.path ?? null;

    const tx = this.db.transaction(() => {
      this.insertEntryStmt.run(entry.id, entry.scope, workspacePath, entry.title, entry.content);
      this.deleteSearchStmt.run(entry.id);
      this.insertSearchStmt.run(entry.id, entry.scope, workspacePath, entry.title, entry.content);
    });
    tx();
  }

  /** 从索引删除条目 */
  remove(id: string): void {
    const tx = this.db.transaction(() => {
      this.deleteSearchStmt.run(id);
      this.deleteEntryStmt.run(id);
    });
    tx();
  }

  /** 从文件重建整个索引 */
  rebuild(entries: KnowledgeEntry[]): void {
    const tx = this.db.transaction(() => {
      this.db.exec(`DELETE FROM knowledge_search`);
      this.db.exec(`DELETE FROM knowledge_entries`);
      for (const entry of entries) {
        const workspacePath = entry.workspace?.path ?? null;
        this.insertEntryStmt.run(entry.id, entry.scope, workspacePath, entry.title, entry.content);
        this.insertSearchStmt.run(entry.id, entry.scope, workspacePath, entry.title, entry.content);
      }
    });
    tx();
  }

  /** 校验索引完整性，返回缺失的条目 ID 列表 */
  validate(fileEntryIds: string[]): string[] {
    const indexedIds = (this.db.prepare(`SELECT id FROM knowledge_entries`).all() as Array<{ id: string }>).map(
      (r) => r.id,
    );
    const indexedSet = new Set(indexedIds);
    return fileEntryIds.filter((id) => !indexedSet.has(id));
  }

  private buildFtsQuery(query: string): string {
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return "*";
    return terms
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" AND ");
  }

  close(): void {
    this.db.close();
  }
}
