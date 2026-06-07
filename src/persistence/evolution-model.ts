import type Database from "better-sqlite3";
import { buildFtsQuery, mapConversation, normalizeSnippet } from "./helpers";
import { buildDynamicWhere } from "./query-helpers";
import type { Conversation } from "../shared/types";
import type { FileConfigStore } from "./file-config-store";
import type {
  CreateEvolutionItemInput,
  EvolutionItem,
  EvolutionItemListFilters,
  EvolutionItemSearchResult,
  EvolutionItemWithConversation,
  UpdateEvolutionItemInput,
} from "../shared/evolution-types";

export class EvolutionModel {
  constructor(private db: Database.Database, private fileConfigStore: FileConfigStore) {}

  create(input: CreateEvolutionItemInput): EvolutionItem {
    this.db.prepare(`INSERT INTO evolution_item (id, workspace_id, title, content, tags, metadata) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(input.id, input.workspaceId, input.title, input.content, JSON.stringify(input.tags ?? []), input.metadata ?? null);
    this.reindex(input.id);
    return this.mustGetRaw(input.id);
  }

  get(id: string): EvolutionItemWithConversation | null {
    const item = this.db
      .prepare("SELECT * FROM evolution_item WHERE id = ?")
      .get(id) as EvolutionItem | undefined;
    return item ? this.withConversation(item) : null;
  }

  list(filters: EvolutionItemListFilters = {}): EvolutionItemSearchResult[] {
    if (filters.query?.trim()) return this.search(filters);
    const built = buildDynamicWhere([
      { value: filters.workspaceId, column: "workspace_id" },
      { value: filters.issueId, column: "issue_id", allowNull: true },
    ]);
    const rows = this.db
      .prepare(
        `SELECT * FROM evolution_item ${built.where} ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?`,
      )
      .all(...built.params, filters.limit ?? 50, filters.offset ?? 0) as EvolutionItem[];
    return rows.map((item) => ({
      ...toSearchResult(item),
      conversation: this.getConversation(item),
    }));
  }

  search(filters: EvolutionItemListFilters): EvolutionItemSearchResult[] {
    const built = buildDynamicWhere(
      [
        { value: filters.workspaceId, column: "workspace_id" },
        { value: filters.issueId, column: "issue_id", allowNull: true },
      ],
      "e.",
    );
    const where = ["evolution_item_search MATCH ?", ...built.clauses].join(" AND ");
    const rows = this.db
      .prepare(
        `SELECT e.*, snippet(evolution_item_search, 3, '[', ']', '...', 24) AS snippet
         FROM evolution_item_search
         JOIN evolution_item e ON e.id = evolution_item_search.evolution_item_id
         WHERE ${where}
         ORDER BY rank, datetime(e.updated_at) DESC
         LIMIT ? OFFSET ?`,
      )
      .all(
        buildFtsQuery(filters.query ?? ""),
        ...built.params,
        filters.limit ?? 50,
        filters.offset ?? 0,
      ) as Array<EvolutionItem & { snippet: string }>;
    return rows.map((row) => ({
      ...toSearchResultWithSnippet(row),
      conversation: this.getConversation(row),
    }));
  }

  update(id: string, input: UpdateEvolutionItemInput): EvolutionItemWithConversation {
    const current = this.mustGetRaw(id);
    this.db
      .prepare(
        `UPDATE evolution_item
         SET issue_id = ?, title = ?, content = ?, tags = ?, metadata = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        input.issueId !== undefined ? input.issueId : current.issue_id,
        input.title ?? current.title,
        input.content ?? current.content,
        JSON.stringify(input.tags ?? JSON.parse(current.tags as unknown as string)),
        input.metadata !== undefined ? input.metadata : current.metadata,
        id,
      );
    this.reindex(id);
    return this.mustGet(id);
  }

  private mustGet(id: string): EvolutionItemWithConversation {
    const item = this.get(id);
    if (!item) throw new Error(`Evolution item not found: ${id}`);
    return item;
  }

  private mustGetRaw(id: string): EvolutionItem {
    const item = this.db
      .prepare("SELECT * FROM evolution_item WHERE id = ?")
      .get(id) as EvolutionItem | undefined;
    if (!item) throw new Error(`Evolution item not found: ${id}`);
    return item;
  }

  private withConversation(item: EvolutionItem): EvolutionItemWithConversation {
    return { ...parseTags(item), conversation: this.getConversation(item) };
  }

  private getConversation(item: EvolutionItem): Conversation | null {
    if (!item.issue_id) return null;
    const conversationRow = this.db
      .prepare(
        "SELECT * FROM conversation WHERE owner_type = 'evolution' AND owner_id = ? ORDER BY datetime(created_at) ASC LIMIT 1",
      )
      .get(item.id) as Record<string, unknown> | undefined;
    return conversationRow ? mapConversation(conversationRow) : null;
  }

  private reindex(evolutionItemId: string): void {
    const item = this.db
      .prepare("SELECT * FROM evolution_item WHERE id = ?")
      .get(evolutionItemId) as EvolutionItem | undefined;
    this.db
      .prepare("DELETE FROM evolution_item_search WHERE evolution_item_id = ?")
      .run(evolutionItemId);
    if (!item) return;
    this.db
      .prepare(
        "INSERT INTO evolution_item_search (evolution_item_id, workspace_id, title, content) VALUES (?, ?, ?, ?)",
      )
      .run(item.id, item.workspace_id, item.title, item.content);
  }
}

function parseTags(item: EvolutionItem): EvolutionItem {
  return { ...item, tags: typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags };
}

function toSearchResult(item: EvolutionItem): EvolutionItemSearchResult {
  return {
    id: item.id,
    workspace_id: item.workspace_id,
    issue_id: item.issue_id,
    title: item.title,
    content: item.content,
    tags: typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags,
    snippet: item.content.slice(0, 240),
    conversation: null,
    updated_at: item.updated_at,
  };
}

function toSearchResultWithSnippet(
  item: EvolutionItem & { snippet: string },
): EvolutionItemSearchResult {
  return { ...toSearchResult(item), snippet: normalizeSnippet(item.snippet) };
}

