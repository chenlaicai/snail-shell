import type Database from "better-sqlite3";
import type { SQLiteDatabase } from "@infra/database";
import { getLogger } from "@infra/logger";
import type { ChannelResult, SearchOptions } from "@domain/memory-search/model";
import type { SearchChannel } from "@domain/memory-search/port";
import { buildFtsMatchQuery } from "@domain/memory-search/_internal/coordinator";

const log = getLogger({ module: "message-search" });

const MESSAGE_SEARCH_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
  message_id UNINDEXED,
  stage_id UNINDEXED,
  context,
  tokenize='trigram'
);
`;

type MessageSearchRow = {
  message_id: number;
  stage_id: string;
  snippet: string;
  bm25_score: number;
  from_speaker: string | null;
  created_at: string;
};

/**
 * Message FTS5 搜索索引。
 *
 * - 索引 message_context.context 字段
 * - 同步写入：message_context 创建时在同一事务内写入 FTS5
 * - 启动时从 message_context 全量重建（B9）
 */
export class MessageSearchIndex {
  private db: SQLiteDatabase;
  private insertStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(db: SQLiteDatabase) {
    this.db = db;
    this.db.exec(MESSAGE_SEARCH_SCHEMA);

    this.insertStmt = this.db.prepare(`
      INSERT INTO message_search (message_id, stage_id, context)
      VALUES (?, ?, ?)
    `);
    this.deleteStmt = this.db.prepare(`DELETE FROM message_search WHERE message_id = ?`);
  }

  /** 同步写入（应在 message_context 写入的同一事务内调用） */
  indexMessage(messageId: number, stageId: string, context: string): void {
    this.deleteStmt.run(messageId);
    this.insertStmt.run(messageId, stageId, context);
  }

  /** 删除索引 */
  removeMessage(messageId: number): void {
    this.deleteStmt.run(messageId);
  }

  /** 从 message_context 全量重建索引 */
  rebuild(): void {
    this.db.transaction(() => {
      this.db.exec(`DELETE FROM message_search`);
      const rows = this.db.all<{ message_id: number; stage_id: string; context: string }>(
        `SELECT mc.message_id, m.stage_id, mc.context
         FROM message_context mc
         JOIN message m ON m.id = mc.message_id`,
      );
      for (const row of rows) {
        this.insertStmt.run(row.message_id, row.stage_id, row.context);
      }
    });
    log.info({ count: this.count() }, "Message search index rebuilt");
  }

  /** 校验索引完整性 */
  validate(): boolean {
    const indexedCount = this.count();
    const sourceCount = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM message_context`,
    )?.count ?? 0;
    return indexedCount === sourceCount;
  }

  private count(): number {
    return this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM message_search`)?.count ?? 0;
  }

  /** SearchChannel 接口：跨 stage 搜索 */
  search(query: string, options: SearchOptions): ChannelResult[] {
    const ftsQuery = buildFtsMatchQuery(query);

    if (ftsQuery) {
      return this.searchByMatch(ftsQuery, options);
    }
    return this.searchByLike(query, options);
  }

  private searchByMatch(ftsQuery: string, options: SearchOptions): ChannelResult[] {
    let sql = `
      SELECT
        ms.message_id,
        ms.stage_id,
        snippet(message_search, 2, '[', ']', '...', 24) AS snippet,
        bm25(message_search) AS bm25_score,
        m.from_speaker,
        m.created_at
      FROM message_search ms
      JOIN message m ON m.id = ms.message_id
      WHERE message_search MATCH ?
    `;
    const params: unknown[] = [ftsQuery];

    if (options.time_range?.after) {
      sql += ` AND m.created_at >= ?`;
      params.push(options.time_range.after);
    }
    if (options.time_range?.before) {
      sql += ` AND m.created_at <= ?`;
      params.push(options.time_range.before);
    }

    sql += ` ORDER BY bm25(message_search) LIMIT 50`;

    const rows = this.db.prepare(sql).all(...params) as MessageSearchRow[];

    return rows.map((row) => ({
      content_type: "message" as const,
      id: String(row.message_id),
      title: row.from_speaker ?? "system",
      snippet: row.snippet,
      raw_score: -row.bm25_score,
      source: {
        domain: "message",
        stage_id: row.stage_id,
      },
      metadata: {
        created_at: row.created_at,
      },
    }));
  }

  private searchByLike(query: string, options: SearchOptions): ChannelResult[] {
    const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    let sql = `
      SELECT
        ms.message_id,
        ms.stage_id,
        m.from_speaker,
        m.created_at
      FROM message_search ms
      JOIN message m ON m.id = ms.message_id
      WHERE ms.context LIKE '%' || ? || '%' ESCAPE '\\'
    `;
    const params: unknown[] = [escaped];

    if (options.time_range?.after) {
      sql += ` AND m.created_at >= ?`;
      params.push(options.time_range.after);
    }
    if (options.time_range?.before) {
      sql += ` AND m.created_at <= ?`;
      params.push(options.time_range.before);
    }

    sql += ` LIMIT 50`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      message_id: number;
      stage_id: string;
      from_speaker: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      content_type: "message" as const,
      id: String(row.message_id),
      title: row.from_speaker ?? "system",
      snippet: "",
      raw_score: 1.0,
      source: {
        domain: "message",
        stage_id: row.stage_id,
      },
      metadata: {
        created_at: row.created_at,
      },
    }));
  }
}

/**
 * Message 域 SearchChannel 实现。
 */
export class MessageSearchChannel implements SearchChannel {
  readonly domain = "message";
  readonly content_type = "message" as const;

  constructor(private index: MessageSearchIndex) {}

  search(query: string, options: SearchOptions): ChannelResult[] {
    return this.index.search(query, options);
  }

  rebuild(): void {
    this.index.rebuild();
  }

  validate(): boolean {
    return this.index.validate();
  }
}
