import type Database from "better-sqlite3";
import type { SQLiteDatabase } from "@infra/database";
import { getLogger } from "@infra/logger";
import type { EvolutionItem, EvolutionItemListFilters } from "@domain/evolution/model";
import type { ChannelResult, SearchOptions } from "@domain/memory-search/model";
import type { SearchChannel } from "@domain/memory-search/port";
import { buildFtsMatchQuery } from "@domain/memory-search/_internal/coordinator";

const log = getLogger({ module: "evolution-search" });

const EVOLUTION_SEARCH_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS evolution_search USING fts5(
  item_id UNINDEXED,
  title,
  content,
  tokenize='trigram'
);
`;

/**
 * Evolution FTS5 搜索索引。
 *
 * - 索引 EvolutionItem 的 title + content
 * - trigram 分词器支持中文子串匹配
 * - <3 字符的查询回退到原始表 LIKE
 * - 增量写入：create 时同步写入 FTS5
 */
export class EvolutionSearchIndex {
  private db: SQLiteDatabase;
  private insertStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(db: SQLiteDatabase) {
    this.db = db;
    this.db.exec(EVOLUTION_SEARCH_SCHEMA);

    this.insertStmt = this.db.prepare(`
      INSERT INTO evolution_search (item_id, title, content)
      VALUES (?, ?, ?)
    `);
    this.deleteStmt = this.db.prepare(`DELETE FROM evolution_search WHERE item_id = ?`);
  }

  /** 索引单条演进项（upsert） */
  indexItem(item: EvolutionItem): void {
    this.deleteStmt.run(item.id);
    this.insertStmt.run(item.id, item.title, item.content);
  }

  /** 从 evolution_item 表全量重建索引 */
  rebuild(): void {
    this.db.transaction(() => {
      this.db.exec(`DELETE FROM evolution_search`);
      const rows = this.db.all<{ id: string; title: string; content: string }>(
        `SELECT id, title, content FROM evolution_item`,
      );
      for (const row of rows) {
        this.insertStmt.run(row.id, row.title, row.content);
      }
    });
    log.info({ count: this.count() }, "Evolution search index rebuilt");
  }

  /** 校验索引完整性 */
  validate(): boolean {
    const indexedCount = this.count();
    const sourceCount = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM evolution_item`,
    )?.count ?? 0;
    return indexedCount === sourceCount;
  }

  private count(): number {
    return this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM evolution_search`)?.count ?? 0;
  }

  /** 搜索，返回 EvolutionItem[]（兼容原有 repo.search 接口） */
  search(query: string, filters?: EvolutionItemListFilters): EvolutionItem[] {
    const ftsQuery = buildFtsMatchQuery(query);

    let items: EvolutionItem[];
    if (ftsQuery) {
      items = this.searchByMatch(ftsQuery, filters);
    } else {
      items = this.searchByLike(query, filters);
    }

    // tag 过滤（内存，同原 repo 逻辑）
    const tagFiltered = filters?.tags?.length
      ? items.filter(item => filters.tags!.some(tag => item.tags.includes(tag)))
      : items;

    // 分页
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    return tagFiltered.slice(offset, offset + limit);
  }

  private searchByMatch(ftsQuery: string, filters?: EvolutionItemListFilters): EvolutionItem[] {
    let sql = `
      SELECT ei.*
      FROM evolution_search es
      JOIN evolution_item ei ON ei.id = es.item_id
      WHERE evolution_search MATCH ?
    `;
    const params: unknown[] = [ftsQuery];

    if (filters?.workspace_id) {
      sql += ` AND ei.workspace_id = ?`;
      params.push(filters.workspace_id);
    }
    if (filters?.status) {
      sql += ` AND ei.status = ?`;
      params.push(filters.status);
    }

    sql += ` ORDER BY bm25(evolution_search) LIMIT 200`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      workspace_id: string;
      status: string;
      issue_id: string | null;
      title: string;
      content: string;
      tags: string;
      result: string | null;
      metadata: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      workspace_id: row.workspace_id,
      status: row.status as EvolutionItem["status"],
      issue_id: row.issue_id,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags),
      result: row.result,
      metadata: JSON.parse(row.metadata),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private searchByLike(query: string, filters?: EvolutionItemListFilters): EvolutionItem[] {
    const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    let sql = `
      SELECT ei.*
      FROM evolution_item ei
      WHERE (ei.title LIKE '%' || ? || '%' ESCAPE '\\' OR ei.content LIKE '%' || ? || '%' ESCAPE '\\')
    `;
    const params: unknown[] = [escaped, escaped];

    if (filters?.workspace_id) {
      sql += ` AND ei.workspace_id = ?`;
      params.push(filters.workspace_id);
    }
    if (filters?.status) {
      sql += ` AND ei.status = ?`;
      params.push(filters.status);
    }

    sql += ` ORDER BY ei.updated_at DESC LIMIT 200`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      workspace_id: string;
      status: string;
      issue_id: string | null;
      title: string;
      content: string;
      tags: string;
      result: string | null;
      metadata: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      workspace_id: row.workspace_id,
      status: row.status as EvolutionItem["status"],
      issue_id: row.issue_id,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags),
      result: row.result,
      metadata: JSON.parse(row.metadata),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  /** SearchChannel 接口：返回 ChannelResult[] */
  searchChannel(query: string, options: SearchOptions): ChannelResult[] {
    const ftsQuery = buildFtsMatchQuery(query);

    if (ftsQuery) {
      return this.searchChannelByMatch(ftsQuery, options);
    }
    return this.searchChannelByLike(query, options);
  }

  private searchChannelByMatch(ftsQuery: string, options: SearchOptions): ChannelResult[] {
    let sql = `
      SELECT
        es.item_id,
        snippet(evolution_search, 2, '[', ']', '...', 24) AS snippet,
        bm25(evolution_search) AS bm25_score,
        ei.title,
        ei.tags,
        ei.created_at,
        ei.updated_at,
        ei.workspace_id,
        ei.status
      FROM evolution_search es
      JOIN evolution_item ei ON ei.id = es.item_id
      WHERE evolution_search MATCH ?
    `;
    const params: unknown[] = [ftsQuery];

    if (options.scope) {
      sql += ` AND ei.workspace_id = ?`;
      params.push(options.scope);
    }

    if (options.time_range?.after) {
      sql += ` AND ei.created_at >= ?`;
      params.push(options.time_range.after);
    }
    if (options.time_range?.before) {
      sql += ` AND ei.created_at <= ?`;
      params.push(options.time_range.before);
    }

    sql += ` ORDER BY bm25(evolution_search) LIMIT 50`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      item_id: string;
      snippet: string;
      bm25_score: number;
      title: string;
      tags: string;
      created_at: string;
      updated_at: string;
      workspace_id: string;
      status: string;
    }>;

    return rows.map((row) => ({
      content_type: "evolution" as const,
      id: row.item_id,
      title: row.title,
      snippet: row.snippet,
      raw_score: -row.bm25_score,
      source: {
        domain: "evolution",
      },
      metadata: {
        tags: JSON.parse(row.tags || "[]"),
        created_at: row.created_at,
        updated_at: row.updated_at,
        status: row.status,
      },
    }));
  }

  private searchChannelByLike(query: string, options: SearchOptions): ChannelResult[] {
    const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    let sql = `
      SELECT
        ei.id AS item_id,
        ei.title,
        ei.content,
        ei.tags,
        ei.created_at,
        ei.updated_at,
        ei.workspace_id,
        ei.status
      FROM evolution_item ei
      WHERE (ei.title LIKE '%' || ? || '%' ESCAPE '\\' OR ei.content LIKE '%' || ? || '%' ESCAPE '\\')
    `;
    const params: unknown[] = [escaped, escaped];

    if (options.scope) {
      sql += ` AND ei.workspace_id = ?`;
      params.push(options.scope);
    }

    if (options.time_range?.after) {
      sql += ` AND ei.created_at >= ?`;
      params.push(options.time_range.after);
    }
    if (options.time_range?.before) {
      sql += ` AND ei.created_at <= ?`;
      params.push(options.time_range.before);
    }

    sql += ` LIMIT 50`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      item_id: string;
      title: string;
      content: string;
      tags: string;
      created_at: string;
      updated_at: string;
      workspace_id: string;
      status: string;
    }>;

    return rows.map((row) => ({
      content_type: "evolution" as const,
      id: row.item_id,
      title: row.title,
      snippet: generateSnippet(row.content, query),
      raw_score: 1.0,
      source: {
        domain: "evolution",
      },
      metadata: {
        tags: JSON.parse(row.tags || "[]"),
        created_at: row.created_at,
        updated_at: row.updated_at,
        status: row.status,
      },
    }));
  }
}

/**
 * Evolution 域 SearchChannel 实现。
 */
export class EvolutionSearchChannel implements SearchChannel {
  readonly domain = "evolution";
  readonly content_type = "evolution" as const;

  constructor(private index: EvolutionSearchIndex) {}

  search(query: string, options: SearchOptions): ChannelResult[] {
    return this.index.searchChannel(query, options);
  }

  rebuild(): void {
    this.index.rebuild();
  }

  validate(): boolean {
    return this.index.validate();
  }
}

/** 为 LIKE 回退搜索生成摘要 */
function generateSnippet(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);

  if (index === -1) {
    return content.slice(0, 100) + "...";
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(content.length, index + query.length + 50);
  const snippet = content.slice(start, end);

  return (start > 0 ? "..." : "") + snippet + (end < content.length ? "..." : "");
}
