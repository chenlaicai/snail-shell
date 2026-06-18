import crypto from "crypto";
import type Database from "better-sqlite3";
import type { SQLiteDatabase } from "@infra/database";
import { getLogger } from "@infra/logger";
import type { KnowledgeEntry } from "@domain/knowledge/model";
import type { SearchResult } from "@domain/knowledge/port";

const log = getLogger({ module: "knowledge" });

/**
 * 知识库搜索索引（FTS5）。
 *
 * 职责：
 * - 提供高性能全文搜索（snippet 高亮）
 * - 从文件真相源重建索引
 * - 索引损坏时自动恢复
 *
 * 限制：
 * - unicode61 分词器不支持中文分词，中文短语会被拆分为单字匹配
 * - 如需精确中文短语搜索，需使用 jieba 等分词插件
 *
 * FTS5 表存储在平台级数据库 snail-shell.db 中，与其他 domain 共享连接。
 */
export class KnowledgeSearchIndex {
  private db: SQLiteDatabase;
  private insertEntryStmt: Database.Statement;
  private insertSearchStmt: Database.Statement;
  private deleteSearchStmt: Database.Statement;
  private deleteEntryStmt: Database.Statement;

  constructor(db: SQLiteDatabase) {
    this.db = db;
    this.initSchema();

    this.insertEntryStmt = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_entries (id, scope, workspace_path, title, content, tags, content_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
        tags TEXT NOT NULL DEFAULT '[]',
        content_hash TEXT NOT NULL,
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
    try {
      const ftsQuery = this.buildFtsQuery(query);
      let sql = `
        SELECT
          ks.entry_id,
          ks.scope,
          ks.workspace_path,
          snippet(knowledge_search, 4, '[', ']', '...', 24) AS snippet,
          ke.title,
          ke.content,
          ke.tags
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
        tags: string;
        snippet: string;
      }>;

      return rows.map((row) => ({
        entry: {
          id: row.entry_id,
          title: row.title,
          content: row.content,
          scope: row.scope as KnowledgeEntry["scope"],
          tags: JSON.parse(row.tags || "[]"),
          workspace: row.workspace_path ? { path: row.workspace_path, summary: null } : undefined,
        },
        snippet: row.snippet,
      }));
    } catch (err) {
      log.error({ err }, "Search failed");
      return [];
    }
  }

  /** 同步单条目到索引（upsert） */
  upsert(entry: KnowledgeEntry): void {
    const workspacePath = entry.workspace?.path ?? null;
    const contentHash = this.computeHash(entry.title, entry.content);
    const tagsJson = JSON.stringify(entry.tags ?? []);

    this.db.transaction(() => {
      this.insertEntryStmt.run(entry.id, entry.scope, workspacePath, entry.title, entry.content, tagsJson, contentHash);
      this.deleteSearchStmt.run(entry.id);
      this.insertSearchStmt.run(entry.id, entry.scope, workspacePath, entry.title, entry.content);
    });
  }

  /** 从索引删除条目 */
  remove(id: string): void {
    this.db.transaction(() => {
      this.deleteSearchStmt.run(id);
      this.deleteEntryStmt.run(id);
    });
  }

  /** 从文件重建整个索引 */
  rebuild(entries: KnowledgeEntry[]): void {
    this.db.transaction(() => {
      this.db.exec(`DELETE FROM knowledge_search`);
      this.db.exec(`DELETE FROM knowledge_entries`);
      for (const entry of entries) {
        const workspacePath = entry.workspace?.path ?? null;
        const contentHash = this.computeHash(entry.title, entry.content);
        const tagsJson = JSON.stringify(entry.tags ?? []);
        this.insertEntryStmt.run(entry.id, entry.scope, workspacePath, entry.title, entry.content, tagsJson, contentHash);
        this.insertSearchStmt.run(entry.id, entry.scope, workspacePath, entry.title, entry.content);
      }
    });
  }

  /**
   * 校验索引完整性。
   * 返回是否需要重建索引（检测缺失、过时、或残留条目）。
   */
  validate(fileEntries: KnowledgeEntry[]): boolean {
    const indexedRows = this.db.prepare(
      `SELECT id, content_hash FROM knowledge_entries`
    ).all() as Array<{ id: string; content_hash: string }>;

    const indexedMap = new Map(indexedRows.map((r) => [r.id, r.content_hash]));
    const fileIds = new Set(fileEntries.map((e) => e.id));

    // 检测索引中存在但文件中已删除的条目（残留）
    for (const id of indexedMap.keys()) {
      if (!fileIds.has(id)) return true;
    }

    // 检测文件中存在但索引中缺失/过时的条目
    for (const entry of fileEntries) {
      const indexedHash = indexedMap.get(entry.id);
      if (!indexedHash) return true;
      const currentHash = this.computeHash(entry.title, entry.content);
      if (indexedHash !== currentHash) return true;
    }

    return false;
  }

  /** 关闭数据库连接（由 SQLiteDatabase 统一管理，此处为空实现） */
  close(): void {
    // 连接由 SQLiteDatabase 统一管理，不需要单独关闭
  }

  private computeHash(title: string, content: string): string {
    return crypto.createHash("sha256").update(`${title}\n${content}`).digest("hex").slice(0, 16);
  }

  private buildFtsQuery(query: string): string {
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return "*";
    return terms
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" AND ");
  }
}
