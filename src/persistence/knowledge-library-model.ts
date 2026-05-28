import type Database from "better-sqlite3";
import { buildFtsQuery, normalizeSnippet } from "./helpers";
import type {
  CreateKnowledgeLibraryInput,
  KnowledgeLibraryEntry,
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
        `INSERT INTO knowledge_library (id, scope, project_id, title, content, status, source_evolution_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.scope,
        input.projectId ?? null,
        input.title,
        input.content,
        status,
        input.sourceEvolutionItemId ?? null,
      );
    this.reindex(input.id);
    return this.mustGet(input.id);
  }

  get(id: string): KnowledgeLibraryEntry | null {
    return (
      (this.db
        .prepare("SELECT * FROM knowledge_library WHERE id = ?")
        .get(id) as KnowledgeLibraryEntry | undefined) ?? null
    );
  }

  list(
    filters: KnowledgeLibraryListFilters = {},
  ): KnowledgeLibrarySearchResult[] {
    if (filters.query?.trim()) return this.search(filters);
    const built = buildWhere(filters);
    const rows = this.db
      .prepare(
        `SELECT * FROM knowledge_library ${built.where} ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...built.params,
        filters.limit ?? 50,
        filters.offset ?? 0,
      ) as KnowledgeLibraryEntry[];
    return rows.map(toSearchResult);
  }

  search(
    filters: KnowledgeLibraryListFilters,
  ): KnowledgeLibrarySearchResult[] {
    const built = buildWhere(filters, "kl.");
    const where = ["knowledge_library_search MATCH ?", ...built.clauses].join(
      " AND ",
    );
    const rows = this.db
      .prepare(
        `SELECT kl.*, snippet(knowledge_library_search, 4, '[', ']', '...', 24) AS snippet
         FROM knowledge_library_search
         JOIN knowledge_library kl ON kl.id = knowledge_library_search.entry_id
         WHERE ${where}
         ORDER BY rank, datetime(kl.updated_at) DESC
         LIMIT ? OFFSET ?`,
      )
      .all(
        buildFtsQuery(filters.query ?? ""),
        ...built.params,
        filters.limit ?? 50,
        filters.offset ?? 0,
      ) as Array<KnowledgeLibraryEntry & { snippet: string }>;
    return rows.map((row) => ({
      ...toSearchResult(row),
      snippet: normalizeSnippet(row.snippet),
    }));
  }

  update(
    id: string,
    updates: UpdateKnowledgeLibraryInput,
  ): KnowledgeLibraryEntry {
    const current = this.mustGet(id);
    this.db
      .prepare(
        `UPDATE knowledge_library SET scope = ?, project_id = ?, title = ?, content = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        updates.scope ?? current.scope,
        updates.projectId !== undefined
          ? updates.projectId
          : current.project_id,
        updates.title ?? current.title,
        updates.content ?? current.content,
        updates.status ?? current.status,
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
    this.db
      .prepare("DELETE FROM knowledge_library_search WHERE entry_id = ?")
      .run(entryId);
    if (!item) return;
    this.db
      .prepare(
        "INSERT INTO knowledge_library_search (entry_id, scope, project_id, status, title, content) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        item.id,
        item.scope,
        item.project_id,
        item.status,
        item.title,
        item.content,
      );
  }
}

function toSearchResult(
  item: KnowledgeLibraryEntry,
): KnowledgeLibrarySearchResult {
  return {
    id: item.id,
    scope: item.scope,
    project_id: item.project_id,
    title: item.title,
    content: item.content,
    snippet: item.content.slice(0, 240),
    status: item.status,
    source_evolution_item_id: item.source_evolution_item_id,
    updated_at: item.updated_at,
  };
}

function buildWhere(
  filters: KnowledgeLibraryListFilters,
  prefix = "",
): { where: string; clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.scope) {
    clauses.push(`${prefix}scope = ?`);
    params.push(filters.scope);
  }
  if (filters.projectId !== undefined) {
    if (filters.projectId === null) {
      clauses.push(`${prefix}project_id IS NULL`);
    } else {
      clauses.push(`${prefix}project_id = ?`);
      params.push(filters.projectId);
    }
  }
  if (filters.status) {
    clauses.push(`${prefix}status = ?`);
    params.push(filters.status);
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    clauses,
    params,
  };
}
