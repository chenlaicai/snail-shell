import type Database from "better-sqlite3";
import { buildFtsQuery, mapKnowledgeGovernance, normalizeSnippet } from "./helpers";
import * as governanceConversationModel from "./knowledge-governance-conversation-model";
import type { CreateKnowledgeInput, KnowledgeApprovalInput, KnowledgeGovernance, KnowledgeGovernanceUpdateInput, KnowledgeItem, KnowledgeListFilters, KnowledgeSearchResult, KnowledgeSource, KnowledgeUse, KnowledgeWithDetails, RecordKnowledgeUseInput } from "./knowledge-types";

export class KnowledgeModel {
  constructor(private db: Database.Database) {}

  create(input: CreateKnowledgeInput): KnowledgeWithDetails {
    const status = input.status ?? "candidate";
    const governanceLevel = input.governanceLevel ?? (status === "candidate" ? "L0" : "L1");
    const tx = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO knowledge_item (id, project_id, scope_type, scope_ref, kind, status, governance_level, title, content, rationale, created_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.projectId ?? null, input.scopeType, input.scopeRef ?? null, input.kind, status, governanceLevel, input.title, input.content, input.rationale ?? null, input.createdBy ?? null, input.metadata ?? null);
      for (const source of input.sources ?? []) {
        this.db.prepare("INSERT INTO knowledge_source (id, knowledge_id, source_type, source_id, quote) VALUES (?, ?, ?, ?, ?)").run(source.id, input.id, source.sourceType, source.sourceId, source.quote ?? null);
      }
      if (status === "candidate") this.createGovernanceShell(input.id, input.title);
      this.reindex(input.id);
    });
    tx();
    return this.get(input.id)!;
  }

  get(id: string): KnowledgeWithDetails | null {
    const item = this.db.prepare("SELECT * FROM knowledge_item WHERE id = ?").get(id) as KnowledgeItem | undefined;
    return item ? this.withDetails(item) : null;
  }

  list(filters: KnowledgeListFilters = {}): KnowledgeSearchResult[] {
    if (filters.query?.trim()) return this.search(filters);
    const query = buildKnowledgeListQuery(filters);
    const rows = this.db.prepare(query.sql).all(...query.params, filters.limit ?? 50, filters.offset ?? 0) as KnowledgeItem[];
    return rows.map((item) => ({ ...toSearchResult(item), governance: this.governance(item.id) }));
  }

  search(filters: KnowledgeListFilters): KnowledgeSearchResult[] {
    const query = buildKnowledgeSearchQuery(filters);
    const rows = this.db.prepare(query.sql).all(...query.params, filters.limit ?? 50, filters.offset ?? 0) as Array<KnowledgeItem & { snippet: string }>;
    return rows.map((item) => ({ ...toSearchResultWithSnippet(item), governance: this.governance(item.id) }));
  }

  approve(id: string, input: KnowledgeApprovalInput): KnowledgeWithDetails {
    const before = this.mustGet(id);
    const updates = input.updates ?? {};
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE knowledge_item SET title = ?, content = ?, rationale = ?, scope_type = ?, scope_ref = ?, kind = ?, governance_level = ?, status = 'active', approved_by = ?, approved_at = datetime('now'), metadata = ?, updated_at = datetime('now') WHERE id = ?`).run(updates.title ?? before.title, updates.content ?? before.content, updates.rationale ?? before.rationale, updates.scope_type ?? before.scope_type, updates.scope_ref ?? before.scope_ref, updates.kind ?? before.kind, updates.governance_level ?? (before.governance_level === "L0" ? "L1" : before.governance_level), input.reviewer, updates.metadata ?? before.metadata, id);
      this.insertReview({ id, reviewer: input.reviewer, decision: "approve", comment: input.comment ?? null, before });
      this.reindex(id);
    });
    tx();
    return this.get(id)!;
  }

  reject(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails { return this.transition({ id, status: "rejected", reviewer, decision: "reject", comment: comment ?? null }); }
  archive(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails { return this.transition({ id, status: "archived", reviewer, decision: "archive", comment: comment ?? null }); }
  deprecate(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails { return this.transition({ id, status: "deprecated", reviewer, decision: "deprecate", comment: comment ?? null }); }

  sources(knowledgeId: string): KnowledgeSource[] {
    return this.db.prepare("SELECT * FROM knowledge_source WHERE knowledge_id = ? ORDER BY datetime(created_at) ASC").all(knowledgeId) as KnowledgeSource[];
  }

  recordUse(input: RecordKnowledgeUseInput): KnowledgeUse {
    this.db.prepare("INSERT INTO knowledge_use (id, knowledge_id, conversation_id, stage_id, snail_name, use_type, outcome, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.knowledgeId, input.conversationId ?? null, input.stageId ?? null, input.snailName ?? null, input.useType, input.outcome ?? null, input.feedback ?? null);
    return this.db.prepare("SELECT * FROM knowledge_use WHERE id = ?").get(input.id) as KnowledgeUse;
  }

  governance(knowledgeId: string): KnowledgeGovernance | null {
    const row = this.db.prepare("SELECT * FROM knowledge_governance WHERE knowledge_id = ?").get(knowledgeId) as Record<string, unknown> | undefined;
    return row ? this.withGovernanceConversation(row) : null;
  }

  getGovernance(id: string): KnowledgeGovernance | null {
    const row = this.db.prepare("SELECT * FROM knowledge_governance WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.withGovernanceConversation(row) : null;
  }

  listGovernance(limit = 50, offset = 0): KnowledgeGovernance[] {
    const rows = this.db.prepare("SELECT * FROM knowledge_governance ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[];
    return rows.map((row) => this.withGovernanceConversation(row));
  }

  updateGovernance(id: string, input: KnowledgeGovernanceUpdateInput): KnowledgeGovernance {
    const current = this.getGovernance(id);
    if (!current) throw new Error(`Knowledge governance not found: ${id}`);
    const dispositionStatus = input.dispositionStatus ?? current.disposition_status;
    const closedAt = ["conclusion_only", "pr_merged", "landed", "reference_only", "merged_or_superseded", "closed", "deferred"].includes(dispositionStatus) ? "datetime('now')" : "NULL";
    this.db.prepare(`UPDATE knowledge_governance SET entry_check_status = ?, dedupe_status = ?, scenario_type = ?, disposition_status = ?, artifact_type = ?, related_knowledge_ids = ?, final_destination = ?, governance_pr_url = ?, disposition_reason = ?, deferred_reason = ?, retrigger_condition = ?, runtime_feedback_allowed = ?, runtime_feedback_channels = ?, closed_at = ${closedAt}, updated_at = datetime('now') WHERE id = ?`).run(input.entryCheckStatus ?? current.entry_check_status, input.dedupeStatus ?? current.dedupe_status, input.scenarioType ?? current.scenario_type, dispositionStatus, input.artifactType ?? current.artifact_type, JSON.stringify(input.relatedKnowledgeIds ?? current.related_knowledge_ids), input.finalDestination ?? current.final_destination, input.governancePrUrl ?? current.governance_pr_url, input.dispositionReason ?? current.disposition_reason, input.deferredReason ?? current.deferred_reason, input.retriggerCondition ?? current.retrigger_condition, (input.runtimeFeedbackAllowed ?? current.runtime_feedback_allowed) ? 1 : 0, JSON.stringify(input.runtimeFeedbackChannels ?? current.runtime_feedback_channels), id);
    return this.getGovernance(id)!;
  }

  uses(knowledgeId: string, limit = 50, offset = 0): KnowledgeUse[] {
    return this.db.prepare("SELECT * FROM knowledge_use WHERE knowledge_id = ? ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?").all(knowledgeId, limit, offset) as KnowledgeUse[];
  }

  private withDetails(item: KnowledgeItem): KnowledgeWithDetails {
    return { ...item, sources: this.sources(item.id), use_count: this.useCount(item.id), governance: this.governance(item.id) };
  }

  private createGovernanceShell(knowledgeId: string, title: string): void {
    const governanceId = `${knowledgeId}:governance`;
    const conversationId = `${governanceId}:conversation`;
    /**
     * 知识治理是知识中心业务壳，不能复用项目管理 feature/conversation/message 表；否则候选治理会污染 Project 工作流数据。
     * 这里只复用协作流程模式，治理对话本身写入 knowledge_governance_conversation 专用表。
     */
    this.db.prepare("INSERT INTO knowledge_governance (id, knowledge_id) VALUES (?, ?)").run(governanceId, knowledgeId);
    governanceConversationModel.createConversation(this.db, { id: conversationId, governanceId, title: `知识治理：${title}`, kind: "discussion", defaultSnail: "知识执行者", participatingSnails: ["Boss Role", "知识执行者"], summary: "Auto-created governance conversation for knowledge candidate" });
  }

  private withGovernanceConversation(row: Record<string, unknown>): KnowledgeGovernance {
    const conversation = governanceConversationModel.getConversationByGovernanceId(this.db, String(row.id));
    return mapKnowledgeGovernance(row, conversation);
  }

  private useCount(knowledgeId: string): number {
    return (this.db.prepare("SELECT COUNT(*) as count FROM knowledge_use WHERE knowledge_id = ?").get(knowledgeId) as { count: number }).count;
  }

  private mustGet(id: string): KnowledgeWithDetails {
    const item = this.get(id);
    if (!item) throw new Error(`Knowledge not found: ${id}`);
    return item;
  }

  private transition(input: TransitionInput): KnowledgeWithDetails {
    const before = this.mustGet(input.id);
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE knowledge_item SET status = ?, updated_at = datetime('now') WHERE id = ?").run(input.status, input.id);
      this.insertReview({ ...input, before });
      this.reindex(input.id);
    });
    tx();
    return this.get(input.id)!;
  }

  private insertReview(input: ReviewInput): void {
    const after = this.db.prepare("SELECT * FROM knowledge_item WHERE id = ?").get(input.id) as KnowledgeItem;
    this.db.prepare("INSERT INTO knowledge_candidate_review (id, knowledge_id, reviewer, decision, comment, before_snapshot, after_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)").run(`${input.id}:review:${Date.now()}`, input.id, input.reviewer, input.decision, input.comment, JSON.stringify(input.before), JSON.stringify(after));
  }

  private reindex(knowledgeId: string): void {
    const item = this.db.prepare("SELECT * FROM knowledge_item WHERE id = ?").get(knowledgeId) as KnowledgeItem | undefined;
    this.db.prepare("DELETE FROM knowledge_search WHERE knowledge_id = ?").run(knowledgeId);
    if (!item) return;
    const sourceQuote = this.sources(knowledgeId).map((source) => source.quote ?? "").filter(Boolean).join("\n");
    this.db.prepare("INSERT INTO knowledge_search (knowledge_id, project_id, scope_type, kind, status, title, content, source_quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(item.id, item.project_id, item.scope_type, item.kind, item.status, item.title, item.content, sourceQuote);
  }
}

function toSearchResult(item: KnowledgeItem): KnowledgeSearchResult {
  return { id: item.id, project_id: item.project_id, scope_type: item.scope_type, scope_ref: item.scope_ref, kind: item.kind, status: item.status, governance_level: item.governance_level, title: item.title, content: item.content, snippet: item.content.slice(0, 240), governance: null, updated_at: item.updated_at };
}

function toSearchResultWithSnippet(item: KnowledgeItem & { snippet: string }): KnowledgeSearchResult {
  return { ...toSearchResult(item), snippet: normalizeSnippet(item.snippet) };
}

function buildKnowledgeListQuery(filters: KnowledgeListFilters): { sql: string; params: unknown[] } {
  const built = buildWhere(filters, "");
  return { sql: `SELECT * FROM knowledge_item ${built.where} ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?`, params: built.params };
}

function buildKnowledgeSearchQuery(filters: KnowledgeListFilters): { sql: string; params: unknown[] } {
  const built = buildWhere(filters, "k.");
  const where = ["knowledge_search MATCH ?", ...built.clauses].join(" AND ");
  return { sql: `SELECT k.*, snippet(knowledge_search, 5, '[', ']', '...', 24) AS snippet FROM knowledge_search JOIN knowledge_item k ON k.id = knowledge_search.knowledge_id WHERE ${where} ORDER BY rank, datetime(k.updated_at) DESC LIMIT ? OFFSET ?`, params: [buildFtsQuery(filters.query ?? ""), ...built.params] };
}

function buildWhere(filters: KnowledgeListFilters, prefix: string): { where: string; clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  addNullableClause(clauses, params, `${prefix}project_id`, filters.projectId);
  addClause(clauses, params, `${prefix}scope_type`, filters.scopeType);
  addClause(clauses, params, `${prefix}scope_ref`, filters.scopeRef);
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

interface TransitionInput {
  id: string;
  status: KnowledgeItem["status"];
  reviewer: string;
  decision: string;
  comment: string | null;
}

interface ReviewInput extends Omit<TransitionInput, "status"> {
  before: KnowledgeWithDetails;
}
