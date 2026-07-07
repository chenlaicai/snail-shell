import type Database from "better-sqlite3";
import type { SQLiteDatabase } from "@infra/database";
import { getLogger } from "@infra/logger";
import type { FeatureDoc, FeatureSearchResult } from "@domain/feature-chain/model";
import type { ChannelResult, SearchOptions } from "@domain/memory-search/model";
import type { SearchChannel } from "@domain/memory-search/port";
import { buildFtsMatchQuery } from "@domain/memory-search/_internal/coordinator";

const log = getLogger({ module: "feature-chain-search" });

const FEATURE_DOC_SEARCH_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS feature_doc_search USING fts5(
  doc_id UNINDEXED,
  title,
  summary,
  body,
  tokenize='trigram'
);
`;

/**
 * Feature Doc FTS5 搜索索引。
 *
 * - 索引 FeatureDoc 的 title + summary + body
 * - trigram 分词器支持中文子串匹配
 * - <3 字符的查询回退到内存 LIKE
 * - 维护内存 Map 用于 LIKE 回退和结果重建
 */
export class FeatureDocSearchIndex {
  private db: SQLiteDatabase;
  private insertStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private docs = new Map<string, FeatureDoc>();

  constructor(db: SQLiteDatabase) {
    this.db = db;
    this.db.exec(FEATURE_DOC_SEARCH_SCHEMA);

    this.insertStmt = this.db.prepare(`
      INSERT INTO feature_doc_search (doc_id, title, summary, body)
      VALUES (?, ?, ?, ?)
    `);
    this.deleteStmt = this.db.prepare(`DELETE FROM feature_doc_search WHERE doc_id = ?`);
  }

  /** 从 FeatureDoc 列表重建索引 */
  rebuild(docs: FeatureDoc[]): void {
    this.db.transaction(() => {
      this.db.exec(`DELETE FROM feature_doc_search`);
      this.docs.clear();
      for (const doc of docs) {
        this.docs.set(doc.id, doc);
        this.insertStmt.run(doc.id, doc.title, doc.summary, doc.body);
      }
    });
    log.info({ count: docs.length }, "Feature doc search index rebuilt");
  }

  /** 搜索，返回 FeatureSearchResult[] */
  search(query: string, limit = 10): FeatureSearchResult[] {
    const ftsQuery = buildFtsMatchQuery(query);

    if (ftsQuery) {
      return this.searchByMatch(ftsQuery, limit);
    }
    return this.searchByLike(query, limit);
  }

  private searchByMatch(ftsQuery: string, limit: number): FeatureSearchResult[] {
    const rows = this.db.prepare(`
      SELECT
        doc_id,
        snippet(feature_doc_search, 1, '[', ']', '...', 24) AS title_snippet,
        snippet(feature_doc_search, 2, '[', ']', '...', 24) AS summary_snippet,
        snippet(feature_doc_search, 3, '[', ']', '...', 24) AS body_snippet,
        bm25(feature_doc_search) AS bm25_score
      FROM feature_doc_search
      WHERE feature_doc_search MATCH ?
      ORDER BY bm25(feature_doc_search)
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{
      doc_id: string;
      title_snippet: string;
      summary_snippet: string;
      body_snippet: string;
      bm25_score: number;
    }>;

    return rows.map((row) => {
      const doc = this.docs.get(row.doc_id);
      return {
        id: row.doc_id,
        title: doc?.title ?? row.doc_id,
        summary: doc?.summary ?? "",
        tags: doc?.tags ?? [],
        modules: doc?.modules ?? [],
        snippet: row.body_snippet || row.summary_snippet || row.title_snippet,
      };
    });
  }

  private searchByLike(query: string, limit: number): FeatureSearchResult[] {
    const lowerQuery = query.toLowerCase();
    const results: FeatureSearchResult[] = [];

    for (const doc of this.docs.values()) {
      const matchFields = [doc.title, doc.summary, ...doc.tags, ...doc.modules].join(" ").toLowerCase();
      if (matchFields.includes(lowerQuery)) {
        results.push({
          id: doc.id,
          title: doc.title,
          summary: doc.summary,
          tags: doc.tags,
          modules: doc.modules,
          snippet: generateSnippet(doc.body, query),
        });
      }
    }

    return results.slice(0, limit);
  }

  /** SearchChannel 接口：返回 ChannelResult[] */
  searchChannel(query: string, _options: SearchOptions): ChannelResult[] {
    const ftsQuery = buildFtsMatchQuery(query);

    if (ftsQuery) {
      return this.searchChannelByMatch(ftsQuery);
    }
    return this.searchChannelByLike(query);
  }

  private searchChannelByMatch(ftsQuery: string): ChannelResult[] {
    const rows = this.db.prepare(`
      SELECT
        doc_id,
        snippet(feature_doc_search, 3, '[', ']', '...', 24) AS snippet,
        bm25(feature_doc_search) AS bm25_score
      FROM feature_doc_search
      WHERE feature_doc_search MATCH ?
      ORDER BY bm25(feature_doc_search)
      LIMIT 50
    `).all(ftsQuery) as Array<{
      doc_id: string;
      snippet: string;
      bm25_score: number;
    }>;

    return rows.map((row) => {
      const doc = this.docs.get(row.doc_id);
      return {
        content_type: "feature_doc" as const,
        id: row.doc_id,
        title: doc?.title ?? row.doc_id,
        snippet: row.snippet,
        raw_score: -row.bm25_score,
        source: {
          domain: "feature-chain",
          file_path: doc?.doc_path,
        },
        metadata: {
          tags: doc?.tags ?? [],
          created_at: doc?.created_at,
        },
      };
    });
  }

  private searchChannelByLike(query: string): ChannelResult[] {
    const lowerQuery = query.toLowerCase();
    const results: ChannelResult[] = [];

    for (const doc of this.docs.values()) {
      const matchFields = [doc.title, doc.summary, ...doc.tags, ...doc.modules].join(" ").toLowerCase();
      if (matchFields.includes(lowerQuery)) {
        results.push({
          content_type: "feature_doc" as const,
          id: doc.id,
          title: doc.title,
          snippet: generateSnippet(doc.body, query),
          raw_score: 1.0,
          source: {
            domain: "feature-chain",
            file_path: doc.doc_path,
          },
          metadata: {
            tags: doc.tags,
            created_at: doc.created_at,
          },
        });
      }
    }

    return results.slice(0, 50);
  }
}

/**
 * Feature Chain 域 SearchChannel 实现。
 */
export class FeatureDocSearchChannel implements SearchChannel {
  readonly domain = "feature-chain";
  readonly content_type = "feature_doc" as const;

  constructor(private index: FeatureDocSearchIndex) {}

  search(query: string, options: SearchOptions): ChannelResult[] {
    return this.index.searchChannel(query, options);
  }

  rebuild(): void {
    // rebuild 由 initor 调用 index.rebuild(repo.listAll())
    // 此处为 no-op
  }

  validate(): boolean {
    // validate 由 initor 处理
    return true;
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
