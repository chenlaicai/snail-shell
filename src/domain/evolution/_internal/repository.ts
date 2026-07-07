import type { SQLiteDatabase } from "@infra/database";
import type {
  EvolutionItem,
  EvolutionItemListFilters,
} from "@domain/evolution/model";

const EVOLUTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS evolution_item (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  issue_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL,
  result TEXT,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evolution_workspace_status_updated ON evolution_item(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_evolution_updated ON evolution_item(updated_at DESC);
`;

type EvolutionItemRow = Omit<EvolutionItem, "tags" | "metadata"> & {
  tags: string;
  metadata: string;
};

/** Evolution 持久层接口 */
export interface EvolutionRepository {
  findById(id: string): EvolutionItem | undefined;
  list(filters?: EvolutionItemListFilters): EvolutionItem[];
  create(item: EvolutionItem): void;
  update(id: string, updates: Partial<Pick<EvolutionItem, "status" | "issue_id" | "result" | "updated_at">>): void;
}

/** Evolution SQLite 存储实现 */
export class SQLiteEvolutionRepository implements EvolutionRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(EVOLUTION_SCHEMA);
  }

  findById(id: string): EvolutionItem | undefined {
    const row = this.db.get<EvolutionItemRow>(`SELECT * FROM evolution_item WHERE id = ?`, [id]);
    return row ? mapEvolutionItem(row) : undefined;
  }

  list(filters?: EvolutionItemListFilters): EvolutionItem[] {
    const rows = this.db.all<EvolutionItemRow>(
      `SELECT * FROM evolution_item ${buildWhereClause(filters)} ORDER BY updated_at DESC`,
      buildWhereParams(filters),
    ).map(mapEvolutionItem);

    const tagFiltered = filterByTags(rows, filters?.tags);
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    return tagFiltered.slice(offset, offset + limit);
  }

  create(item: EvolutionItem): void {
    this.db.run(
      `INSERT INTO evolution_item (id, workspace_id, status, issue_id, title, content, tags, result, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.workspace_id,
        item.status,
        item.issue_id,
        item.title,
        item.content,
        JSON.stringify(item.tags),
        item.result,
        JSON.stringify(item.metadata),
        item.created_at,
        item.updated_at,
      ],
    );
  }

  update(id: string, updates: Partial<Pick<EvolutionItem, "status" | "issue_id" | "result" | "updated_at">>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.issue_id !== undefined) {
      sets.push("issue_id = ?");
      params.push(updates.issue_id);
    }
    if (updates.result !== undefined) {
      sets.push("result = ?");
      params.push(updates.result);
    }
    sets.push("updated_at = ?");
    params.push(updates.updated_at ?? new Date().toISOString());
    params.push(id);
    this.db.run(`UPDATE evolution_item SET ${sets.join(", ")} WHERE id = ?`, params);
  }
}

function buildWhereClause(filters?: EvolutionItemListFilters): string {
  const clauses: string[] = [];
  if (filters?.workspace_id) clauses.push("workspace_id = ?");
  if (filters?.status) clauses.push("status = ?");
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function buildWhereParams(filters?: EvolutionItemListFilters): unknown[] {
  const params: unknown[] = [];
  if (filters?.workspace_id) params.push(filters.workspace_id);
  if (filters?.status) params.push(filters.status);
  return params;
}

function filterByTags(items: EvolutionItem[], tags?: string[]): EvolutionItem[] {
  return tags?.length
    ? items.filter(item => tags.some(tag => item.tags.includes(tag)))
    : items;
}

function mapEvolutionItem(row: EvolutionItemRow): EvolutionItem {
  return {
    ...row,
    tags: JSON.parse(row.tags),
    metadata: JSON.parse(row.metadata),
  };
}
