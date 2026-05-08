import type Database from "better-sqlite3";
import { buildFtsQuery, mapKnowledgeUsagePolicy, normalizeSnippet, serializeKnowledgeUsagePolicyInput } from "./helpers";
import type { SnailName, StageType } from "./types";
import type { CreateKnowledgeInput, CreateOrMergeKnowledgeCandidateResult, KnowledgeApprovalInput, KnowledgeItem, KnowledgeListFilters, KnowledgeSearchResult, KnowledgeSource, KnowledgeUsagePolicy, KnowledgeUsagePolicyInput, KnowledgeUse, KnowledgeWithDetails, RecordKnowledgeUseInput } from "./knowledge-types";

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
      this.reindex(input.id);
    });
    tx();
    return this.get(input.id)!;
  }

  createOrMergeCandidate(input: CreateKnowledgeInput): CreateOrMergeKnowledgeCandidateResult {
    const candidateInput = { ...input, status: "candidate" as const, governanceLevel: "L0" as const };
    const duplicate = this.findDuplicateCandidateTarget(candidateInput);
    if (!duplicate) {
      return { knowledge: this.create(candidateInput), action: "created", duplicate_of: null };
    }

    const tx = this.db.transaction(() => {
      /**
       * 已生效或已治理知识不能被新候选自动改写，否则一次重复提取就能绕过人工审批改变后续 prompt 行为。
       * 只有仍在审批队列中的 candidate 可以合并正文；其他状态只追加来源并记录负向反馈，供后续人工根因分析。
       */
      if (duplicate.status === "candidate") {
        this.db.prepare("UPDATE knowledge_item SET title = ?, content = ?, rationale = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?").run(candidateInput.title, candidateInput.content, candidateInput.rationale ?? duplicate.rationale, candidateInput.metadata ?? duplicate.metadata, duplicate.id);
      }
      this.insertMissingSources(duplicate.id, candidateInput.sources ?? []);
      this.recordUse({
        id: `${duplicate.id}:duplicate:${Date.now()}:${Math.random()}`,
        knowledgeId: duplicate.id,
        useType: "duplicate_candidate",
        outcome: duplicate.status,
        feedback: buildDuplicateCandidateFeedback(candidateInput),
      });
      this.reindex(duplicate.id);
    });
    tx();
    return { knowledge: this.get(duplicate.id)!, action: "merged", duplicate_of: duplicate.id };
  }

  get(id: string): KnowledgeWithDetails | null {
    const item = this.db.prepare("SELECT * FROM knowledge_item WHERE id = ?").get(id) as KnowledgeItem | undefined;
    return item ? this.withDetails(item) : null;
  }

  list(filters: KnowledgeListFilters = {}): KnowledgeSearchResult[] {
    if (filters.query?.trim()) return this.search(filters);
    const query = buildKnowledgeListQuery(filters);
    const rows = this.db.prepare(query.sql).all(...query.params, filters.limit ?? 50, filters.offset ?? 0) as KnowledgeItem[];
    return rows.map(toSearchResult);
  }

  search(filters: KnowledgeListFilters): KnowledgeSearchResult[] {
    const query = buildKnowledgeSearchQuery(filters);
    const rows = this.db.prepare(query.sql).all(...query.params, filters.limit ?? 50, filters.offset ?? 0) as Array<KnowledgeItem & { snippet: string }>;
    return rows.map(toSearchResultWithSnippet);
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

  policy(knowledgeId: string): KnowledgeUsagePolicy | null {
    const row = this.db.prepare("SELECT * FROM knowledge_usage_policy WHERE knowledge_id = ?").get(knowledgeId) as Record<string, unknown> | undefined;
    return row ? mapKnowledgeUsagePolicy(row) : null;
  }

  upsertPolicy(knowledgeId: string, input: KnowledgeUsagePolicyInput): KnowledgeUsagePolicy {
    const values = mergePolicy(input, this.policy(knowledgeId));
    this.db.prepare(`INSERT INTO knowledge_usage_policy (knowledge_id, allow_prompt_injection, prompt_mode, skill_visibility, tool_visibility, checker_binding, stage_types, snail_names, priority, token_budget) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(knowledge_id) DO UPDATE SET allow_prompt_injection = excluded.allow_prompt_injection, prompt_mode = excluded.prompt_mode, skill_visibility = excluded.skill_visibility, tool_visibility = excluded.tool_visibility, checker_binding = excluded.checker_binding, stage_types = excluded.stage_types, snail_names = excluded.snail_names, priority = excluded.priority, token_budget = excluded.token_budget, updated_at = datetime('now')`).run(knowledgeId, values.allowPromptInjection, values.promptMode, values.skillVisibility, values.toolVisibility, values.checkerBinding, values.stageTypes, values.snailNames, values.priority, values.tokenBudget);
    return this.policy(knowledgeId)!;
  }

  recordUse(input: RecordKnowledgeUseInput): KnowledgeUse {
    this.db.prepare("INSERT INTO knowledge_use (id, knowledge_id, conversation_id, stage_id, snail_name, use_type, outcome, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.knowledgeId, input.conversationId ?? null, input.stageId ?? null, input.snailName ?? null, input.useType, input.outcome ?? null, input.feedback ?? null);
    return this.db.prepare("SELECT * FROM knowledge_use WHERE id = ?").get(input.id) as KnowledgeUse;
  }

  uses(knowledgeId: string, limit = 50, offset = 0): KnowledgeUse[] {
    return this.db.prepare("SELECT * FROM knowledge_use WHERE knowledge_id = ? ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?").all(knowledgeId, limit, offset) as KnowledgeUse[];
  }

  injectable(input: { projectId: string; featureId: string; stageType: StageType; snailName: SnailName; conversationId?: string | null; stageId?: string | null; limit?: number }): KnowledgeWithDetails[] {
    /**
     * Prompt 注入是知识反哺中风险最高的路径，因此这里同时校验治理状态、作用域和使用策略。
     * prompt_mode = 'none' 是显式禁用内容注入的治理决策，即使 allow_prompt_injection 仍为 true，也不能进入候选集。
     * stage_types/snail_names 为空表示策略未进一步收窄；一旦填写，就必须与当前调用上下文匹配，避免已审批知识跨角色或跨阶段污染。
     */
    const rows = this.db.prepare(`SELECT k.* FROM knowledge_item k JOIN knowledge_usage_policy p ON p.knowledge_id = k.id WHERE k.status = 'active' AND p.allow_prompt_injection = 1 AND p.prompt_mode != 'none' AND (p.stage_types = '[]' OR EXISTS (SELECT 1 FROM json_each(p.stage_types) WHERE value = ?)) AND (p.snail_names = '[]' OR EXISTS (SELECT 1 FROM json_each(p.snail_names) WHERE value = ?)) AND (k.scope_type = 'global' OR (k.scope_type = 'project' AND k.scope_ref = ?) OR (k.scope_type = 'feature' AND k.scope_ref = ?) OR (k.scope_type = 'stage_type' AND k.scope_ref = ?) OR (k.scope_type = 'snail' AND k.scope_ref = ?) OR (k.scope_type = 'workflow')) ORDER BY p.priority DESC, datetime(k.updated_at) DESC LIMIT ?`).all(input.stageType, input.snailName, input.projectId, input.featureId, input.stageType, input.snailName, input.limit ?? 8) as KnowledgeItem[];
    for (const row of rows) {
      this.recordUse({ id: `${row.id}:use:${Date.now()}:${Math.random()}`, knowledgeId: row.id, conversationId: input.conversationId ?? null, stageId: input.stageId ?? null, snailName: input.snailName, useType: "prompt_injection" });
    }
    return rows.map((item) => this.withDetails(item));
  }

  private withDetails(item: KnowledgeItem): KnowledgeWithDetails {
    return { ...item, sources: this.sources(item.id), usage_policy: this.policy(item.id), use_count: this.useCount(item.id) };
  }

  private useCount(knowledgeId: string): number {
    return (this.db.prepare("SELECT COUNT(*) as count FROM knowledge_use WHERE knowledge_id = ?").get(knowledgeId) as { count: number }).count;
  }

  private mustGet(id: string): KnowledgeWithDetails {
    const item = this.get(id);
    if (!item) throw new Error(`Knowledge not found: ${id}`);
    return item;
  }

  private findDuplicateCandidateTarget(input: CreateKnowledgeInput): KnowledgeItem | null {
    const candidates = this.db.prepare("SELECT * FROM knowledge_item WHERE project_id IS ? AND scope_type = ? AND scope_ref IS ? AND kind = ? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END, datetime(updated_at) DESC").all(input.projectId ?? null, input.scopeType, input.scopeRef ?? null, input.kind) as KnowledgeItem[];
    const normalizedTitle = normalizeKnowledgeDuplicateText(input.title);
    const normalizedContent = normalizeKnowledgeDuplicateText(input.content);
    return candidates.find((item) => normalizeKnowledgeDuplicateText(item.title) === normalizedTitle && normalizeKnowledgeDuplicateText(item.content) === normalizedContent) ?? null;
  }

  private insertMissingSources(knowledgeId: string, sources: NonNullable<CreateKnowledgeInput["sources"]>): void {
    const existing = new Set(this.sources(knowledgeId).map((source) => `${source.source_type}\u0000${source.source_id}\u0000${source.quote ?? ""}`));
    for (const source of sources) {
      const key = `${source.sourceType}\u0000${source.sourceId}\u0000${source.quote ?? ""}`;
      if (existing.has(key)) continue;
      this.db.prepare("INSERT INTO knowledge_source (id, knowledge_id, source_type, source_id, quote) VALUES (?, ?, ?, ?, ?)").run(source.id, knowledgeId, source.sourceType, source.sourceId, source.quote ?? null);
      existing.add(key);
    }
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

function normalizeKnowledgeDuplicateText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").trim();
}

function buildDuplicateCandidateFeedback(input: CreateKnowledgeInput): string {
  const sourceSummary = (input.sources ?? []).map((source) => `${source.sourceType}:${source.sourceId}`).join(", ") || "no-source";
  return JSON.stringify({ title: input.title, sources: sourceSummary });
}

function toSearchResult(item: KnowledgeItem): KnowledgeSearchResult {
  return { id: item.id, project_id: item.project_id, scope_type: item.scope_type, scope_ref: item.scope_ref, kind: item.kind, status: item.status, governance_level: item.governance_level, title: item.title, content: item.content, snippet: item.content.slice(0, 240), updated_at: item.updated_at };
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

function mergePolicy(input: KnowledgeUsagePolicyInput, existing: KnowledgeUsagePolicy | null): ReturnType<typeof serializeKnowledgeUsagePolicyInput> {
  return serializeKnowledgeUsagePolicyInput({ ...policyFallback(existing), ...input });
}

function policyFallback(existing: KnowledgeUsagePolicy | null): KnowledgeUsagePolicyInput {
  return { allowPromptInjection: existing?.allow_prompt_injection ?? false, promptMode: existing?.prompt_mode ?? "reference_only", skillVisibility: existing?.skill_visibility ?? [], toolVisibility: existing?.tool_visibility ?? [], checkerBinding: existing?.checker_binding ?? null, stageTypes: existing?.stage_types ?? [], snailNames: existing?.snail_names ?? [], priority: existing?.priority ?? 0, tokenBudget: existing?.token_budget ?? null };
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
