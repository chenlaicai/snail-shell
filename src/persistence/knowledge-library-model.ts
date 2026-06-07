import type Database from "better-sqlite3";
import { buildFtsQuery, normalizeSnippet } from "./helpers";
import { buildDynamicWhere } from "./query-helpers";
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
    if (input.scope === "workspace" && !input.workspaceId) {
      throw new Error("workspace_id is required when scope is 'workspace'");
    }
    this.db
      .prepare(
        `INSERT INTO knowledge_library (id, scope, workspace_id, title, content, source_evolution_item_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.scope,
        input.workspaceId ?? null,
        input.title,
        input.content,
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
    const built = buildDynamicWhere([
      { value: filters.scope, column: "scope" },
      { value: filters.workspaceId, column: "workspace_id", allowNull: true },
    ]);
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
    const built = buildDynamicWhere(
      [
        { value: filters.scope, column: "scope" },
        { value: filters.workspaceId, column: "workspace_id", allowNull: true },
      ],
      "kl.",
    );
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

  /** 返回全局知识 + 指定工作区的知识摘要。全局知识（scope=global, workspace_id IS NULL）对所有工作区可见。 */
  summary(workspaceId?: string): { scope: string; count: number }[] {
    const where = workspaceId ? "WHERE workspace_id = ? OR workspace_id IS NULL" : "";
    const params = workspaceId ? [workspaceId] : [];
    return this.db
      .prepare(
        `SELECT scope, COUNT(*) as count FROM knowledge_library ${where} GROUP BY scope ORDER BY scope ASC`,
      )
      .all(...params) as { scope: string; count: number }[];
  }

  update(
    id: string,
    updates: UpdateKnowledgeLibraryInput,
  ): KnowledgeLibraryEntry {
    const current = this.mustGet(id);
    const newScope = updates.scope ?? current.scope;
    const newWorkspaceId = updates.workspaceId !== undefined ? updates.workspaceId : current.workspace_id;
    if (newScope === "workspace" && !newWorkspaceId) {
      throw new Error("workspace_id is required when scope is 'workspace'");
    }
    this.db
      .prepare(
        `UPDATE knowledge_library SET scope = ?, workspace_id = ?, title = ?, content = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        newScope,
        newWorkspaceId,
        updates.title ?? current.title,
        updates.content ?? current.content,
        id,
      );
    this.reindex(id);
    return this.mustGet(id);
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
        "INSERT INTO knowledge_library_search (entry_id, scope, workspace_id, title, content) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        item.id,
        item.scope,
        item.workspace_id,
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
    workspace_id: item.workspace_id,
    title: item.title,
    content: item.content,
    snippet: item.content.slice(0, 240),
    source_evolution_item_id: item.source_evolution_item_id,
    updated_at: item.updated_at,
  };
}

