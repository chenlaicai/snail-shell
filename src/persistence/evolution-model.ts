import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { buildFtsQuery, mapConversation, normalizeSnippet } from "./helpers";
import type { Conversation } from "./types";
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

  create(input: CreateEvolutionItemInput): EvolutionItemWithConversation {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO evolution_item (id, workspace_id, title, content, tags, metadata)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.workspaceId,
          input.title,
          input.content,
          JSON.stringify(input.tags ?? []),
          input.metadata ?? null,
        );
      /** 治理对话的 workspace_id 固定为 "evolution-center"，因为 stage definition 和角色定义
       *  都绑定在 evolution-center 工作区上。演进工作区自身的 workspace_id 仍为来源工作区。 */
      const issueId = randomUUID();
      this.db
        .prepare(
          "INSERT INTO issue (id, workspace_id, title, summary, task_anchor, role_snail_mapping) VALUES (?, ?, ?, NULL, NULL, '{}')",
        )
        .run(issueId, "evolution-center", input.title);
      /* 动态解析 stage_definition_id：通过 FileConfigStore 在 evolution-center 工作区
         查找 key='development' 的 stage definition。 */
      const stageDef = this.fileConfigStore.getStageDefinitionByKey("evolution-center", "development");
      if (!stageDef) throw new Error("Evolution Center stage definition 'development' not found — ensure SOP is loaded and bound to evolution-center workspace");
      const stageId = randomUUID();
      this.db
        .prepare(
          "INSERT INTO stage (id, workspace_id, issue_id, stage_definition_id, type, sequence, status, output_artifacts, entered_at) VALUES (?, ?, ?, ?, 'development', 1, 'in_progress', '{}', datetime('now'))",
        )
        .run(stageId, "evolution-center", issueId, stageDef.id);
      const convId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO conversation (id, workspace_id, issue_id, stage_id, kind, title, owner_type, owner_id, summary, status, default_role, participating_roles, from_conversation_ids)
           VALUES (?, ?, ?, ?, 'discussion', ?, 'evolution', ?, '治理对话', 'active', '演进执行者', '["Boss Role","演进执行者"]', '[]')`,
        )
        .run(convId, "evolution-center", issueId, stageId, input.title, input.id);
      // 更新 evolution_item 的 issue_id
      this.db.prepare("UPDATE evolution_item SET issue_id = ? WHERE id = ?").run(issueId, input.id);
      this.reindex(input.id);
    });
    tx();
    return this.mustGet(input.id);
  }

  get(id: string): EvolutionItemWithConversation | null {
    const item = this.db
      .prepare("SELECT * FROM evolution_item WHERE id = ?")
      .get(id) as EvolutionItem | undefined;
    return item ? this.withConversation(item) : null;
  }

  list(filters: EvolutionItemListFilters = {}): EvolutionItemSearchResult[] {
    if (filters.query?.trim()) return this.search(filters);
    const built = buildWhere(filters);
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
    const built = buildWhere(filters, "e.");
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

function buildWhere(
  filters: EvolutionItemListFilters,
  prefix = "",
): { where: string; clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.workspaceId) {
    clauses.push(`${prefix}workspace_id = ?`);
    params.push(filters.workspaceId);
  }
  if (filters.issueId !== undefined) {
    if (filters.issueId === null) {
      clauses.push(`${prefix}issue_id IS NULL`);
    } else {
      clauses.push(`${prefix}issue_id = ?`);
      params.push(filters.issueId);
    }
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    clauses,
    params,
  };
}
