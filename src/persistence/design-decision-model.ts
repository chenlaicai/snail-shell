import type Database from "better-sqlite3";
import { buildFtsQuery, normalizeSnippet } from "./helpers";
import type { CreateDesignDecisionInput, DesignDecision, DesignDecisionListFilters, DesignDecisionSearchResult, UpdateDesignDecisionInput } from "../shared/design-decision-types";

export class DesignDecisionModel {
  constructor(private db: Database.Database) {}

  create(input: CreateDesignDecisionInput): DesignDecision {
    const status = input.status ?? "active";
    this.db.prepare(`INSERT INTO design_decision (id, project_id, scope_type, scope_ref, title, content, status, source_knowledge_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.projectId ?? null, input.scopeType, input.scopeRef ?? null, input.title, input.content, status, input.sourceKnowledgeId ?? null);
    this.reindex(input.id);
    return this.mustGet(input.id);
  }

  get(id: string): DesignDecision | null {
    return (this.db.prepare("SELECT * FROM design_decision WHERE id = ?").get(id) as DesignDecision | undefined) ?? null;
  }

  list(filters: DesignDecisionListFilters = {}): DesignDecisionSearchResult[] {
    if (filters.query?.trim()) return this.search(filters);
    const built = buildWhere(filters);
    const rows = this.db.prepare(`SELECT * FROM design_decision ${built.where} ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?`).all(...built.params, filters.limit ?? 50, filters.offset ?? 0) as DesignDecision[];
    return rows.map(toSearchResult);
  }

  search(filters: DesignDecisionListFilters): DesignDecisionSearchResult[] {
    const built = buildWhere(filters, "d.");
    const where = ["design_decision_search MATCH ?", ...built.clauses].join(" AND ");
    const rows = this.db.prepare(`SELECT d.*, snippet(design_decision_search, 4, '[', ']', '...', 24) AS snippet FROM design_decision_search JOIN design_decision d ON d.id = design_decision_search.decision_id WHERE ${where} ORDER BY rank, datetime(d.updated_at) DESC LIMIT ? OFFSET ?`).all(buildFtsQuery(filters.query ?? ""), ...built.params, filters.limit ?? 50, filters.offset ?? 0) as Array<DesignDecision & { snippet: string }>;
    return rows.map((row) => ({ ...toSearchResult(row), snippet: normalizeSnippet(row.snippet) }));
  }

  update(id: string, updates: UpdateDesignDecisionInput): DesignDecision {
    const current = this.mustGet(id);
    this.db.prepare(`UPDATE design_decision SET title = ?, content = ?, status = ?, scope_type = ?, scope_ref = ?, project_id = ?, updated_at = datetime('now') WHERE id = ?`).run(updates.title ?? current.title, updates.content ?? current.content, updates.status ?? current.status, updates.scopeType ?? current.scope_type, updates.scopeRef ?? current.scope_ref, updates.projectId ?? current.project_id, id);
    this.reindex(id);
    return this.mustGet(id);
  }

  deprecate(id: string): DesignDecision {
    return this.update(id, { status: "deprecated" });
  }

  private mustGet(id: string): DesignDecision {
    const item = this.get(id);
    if (!item) throw new Error(`Design decision not found: ${id}`);
    return item;
  }

  private reindex(decisionId: string): void {
    const item = this.get(decisionId);
    this.db.prepare("DELETE FROM design_decision_search WHERE decision_id = ?").run(decisionId);
    if (!item) return;
    this.db.prepare("INSERT INTO design_decision_search (decision_id, project_id, scope_type, status, title, content) VALUES (?, ?, ?, ?, ?, ?)").run(item.id, item.project_id, item.scope_type, item.status, item.title, item.content);
  }
}

function toSearchResult(item: DesignDecision): DesignDecisionSearchResult {
  return { id: item.id, project_id: item.project_id, scope_type: item.scope_type, scope_ref: item.scope_ref, title: item.title, content: item.content, snippet: item.content.slice(0, 240), status: item.status, source_knowledge_id: item.source_knowledge_id, updated_at: item.updated_at };
}

function buildWhere(filters: DesignDecisionListFilters, prefix = ""): { where: string; clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  addNullableClause(clauses, params, `${prefix}project_id`, filters.projectId);
  addClause(clauses, params, `${prefix}scope_type`, filters.scopeType);
  addClause(clauses, params, `${prefix}scope_ref`, filters.scopeRef);
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
