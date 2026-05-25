import type Database from "better-sqlite3";
import { buildFtsQuery, normalizeSnippet } from "./helpers";
import type {
  CreateKnowledgeLibraryInput,
  KnowledgeLibraryEntry,
  KnowledgeLibraryKindSummary,
  KnowledgeLibraryListFilters,
  KnowledgeLibrarySearchResult,
  UpdateKnowledgeLibraryInput,
} from "../shared/knowledge-library-types";

export class KnowledgeLibraryModel {
  constructor(private db: Database.Database) {}

  create(input: CreateKnowledgeLibraryInput): KnowledgeLibraryEntry {
    const status = input.status ?? "active";
    this.db
      .prepare(
        `INSERT INTO knowledge_library (id, project_id, kind, title, summary, use_scenarios, non_use_scenarios, content, status, source_knowledge_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId ?? null,
        input.kind,
        input.title,
        input.summary ?? "",
        input.useScenarios ?? "",
        input.nonUseScenarios ?? "",
        input.content,
        status,
        input.sourceKnowledgeId ?? null,
      );
    this.reindex(input.id);
    return this.mustGet(input.id);
  }

  get(id: string): KnowledgeLibraryEntry | null {
    return (this.db.prepare("SELECT * FROM knowledge_library WHERE id = ?").get(id) as KnowledgeLibraryEntry | undefined) ?? null;
  }

  /** L1 概览：按 kind 分组返回各分类条目数（仅 active 条目）。 */
  kindSummaries(projectId?: string | null): KnowledgeLibraryKindSummary[] {
    const where = projectId ? "WHERE project_id = ? AND status = 'active'" : "WHERE status = 'active'";
    const params = projectId ? [projectId] : [];
    return this.db.prepare(`SELECT kind, COUNT(*) as count FROM knowledge_library ${where} GROUP BY kind ORDER BY kind ASC`).all(...params) as KnowledgeLibraryKindSummary[];
  }

  /** L2 按 kind 列出条目摘要（概要 + 使用场景 + 非使用场景，不含正文）。 */
  list(filters: KnowledgeLibraryListFilters = {}): KnowledgeLibrarySearchResult[] {
    if (filters.query?.trim()) return this.search(filters);
    const built = buildWhere(filters);
    const rows = this.db
      .prepare(`SELECT * FROM knowledge_library ${built.where} ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?`)
      .all(...built.params, filters.limit ?? 50, filters.offset ?? 0) as KnowledgeLibraryEntry[];
    return rows.map(toSearchResult);
  }

  search(filters: KnowledgeLibraryListFilters): KnowledgeLibrarySearchResult[] {
    const built = buildWhere(filters, "kl.");
    const where = ["knowledge_library_search MATCH ?", ...built.clauses].join(" AND ");
    const rows = this.db
      .prepare(
        `SELECT kl.*, snippet(knowledge_library_search, 5, '[', ']', '...', 24) AS snippet
       FROM knowledge_library_search
       JOIN knowledge_library kl ON kl.id = knowledge_library_search.entry_id
       WHERE ${where}
       ORDER BY rank, datetime(kl.updated_at) DESC
       LIMIT ? OFFSET ?`,
      )
      .all(buildFtsQuery(filters.query ?? ""), ...built.params, filters.limit ?? 50, filters.offset ?? 0) as Array<KnowledgeLibraryEntry & { snippet: string }>;
    return rows.map((row) => ({ ...toSearchResult(row), snippet: normalizeSnippet(row.snippet) }));
  }

  update(id: string, updates: UpdateKnowledgeLibraryInput): KnowledgeLibraryEntry {
    const current = this.mustGet(id);
    this.db
      .prepare(
        `UPDATE knowledge_library SET title = ?, summary = ?, use_scenarios = ?, non_use_scenarios = ?, content = ?, status = ?, kind = ?, project_id = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        updates.title ?? current.title,
        updates.summary ?? current.summary,
        updates.useScenarios ?? current.use_scenarios,
        updates.nonUseScenarios ?? current.non_use_scenarios,
        updates.content ?? current.content,
        updates.status ?? current.status,
        updates.kind ?? current.kind,
        updates.projectId ?? current.project_id,
        id,
      );
    this.reindex(id);
    return this.mustGet(id);
  }

  deprecate(id: string): KnowledgeLibraryEntry {
    return this.update(id, { status: "deprecated" });
  }

  private mustGet(id: string): KnowledgeLibraryEntry {
    const item = this.get(id);
    if (!item) throw new Error(`Knowledge library entry not found: ${id}`);
    return item;
  }

  private reindex(entryId: string): void {
    const item = this.get(entryId);
    this.db.prepare("DELETE FROM knowledge_library_search WHERE entry_id = ?").run(entryId);
    if (!item) return;
    this.db
      .prepare("INSERT INTO knowledge_library_search (entry_id, project_id, kind, status, title, summary, content) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.project_id, item.kind, item.status, item.title, item.summary, item.content);
  }
}

function toSearchResult(item: KnowledgeLibraryEntry): KnowledgeLibrarySearchResult {
  return {
    id: item.id,
    project_id: item.project_id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    use_scenarios: item.use_scenarios,
    non_use_scenarios: item.non_use_scenarios,
    content: item.content,
    snippet: item.summary || item.content.slice(0, 240),
    status: item.status,
    source_knowledge_id: item.source_knowledge_id,
    updated_at: item.updated_at,
  };
}

function buildWhere(filters: KnowledgeLibraryListFilters, prefix = ""): { where: string; clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  addNullableClause(clauses, params, `${prefix}project_id`, filters.projectId);
  addClause(clauses, params, `${prefix}kind`, filters.kind);
  addClause(clauses, params, `${prefix}status`, filters.status);
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", clauses, params };
}

function addClause(clauses: string[], params: unknown[], field: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  clauses.push(`${field} = ?`);
  params.push(value);
}

function addNullableClause(clauses: string[], params: unknown[], field: string, value: string | null | undefined): void {
  if (value === undefined) return;
  if (value === null) clauses.push(`${field} IS NULL`);
  else addClause(clauses, params, field, value);
}
