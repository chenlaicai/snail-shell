import type Database from "better-sqlite3";
import { buildFtsQuery, mapKnowledgeUsagePolicy, normalizeSnippet, serializeKnowledgeUsagePolicyInput } from "./helpers";
import type { SnailName, StageType } from "./types";
import type { CreateKnowledgeChangeRequestInput, KnowledgeChangeRequest, KnowledgeDocumentSyncInput, CreateKnowledgeInput, KnowledgeApprovalInput, KnowledgeItem, KnowledgeListFilters, KnowledgeSearchResult, KnowledgeSource, KnowledgeUsagePolicy, KnowledgeUsagePolicyInput, KnowledgeUse, KnowledgeWithDetails, RecordKnowledgeUseInput } from "./knowledge-types";

export class KnowledgeModel {
  constructor(private db: Database.Database) {}

  create(input: CreateKnowledgeInput): KnowledgeWithDetails {
    const status = input.status ?? "candidate";
    const governanceLevel = input.governanceLevel ?? (status === "candidate" ? "L0" : "L1");
    const tx = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO knowledge_item (id, project_id, scope_type, scope_ref, kind, status, governance_level, title, content, rationale, created_by, metadata, runtime_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.projectId ?? null, input.scopeType, input.scopeRef ?? null, input.kind, status, governanceLevel, input.title, input.content, input.rationale ?? null, input.createdBy ?? null, input.metadata ?? null, "inactive");
      for (const source of input.sources ?? []) {
        this.db.prepare("INSERT INTO knowledge_source (id, knowledge_id, source_type, source_id, quote) VALUES (?, ?, ?, ?, ?)").run(source.id, input.id, source.sourceType, source.sourceId, source.quote ?? null);
      }
      this.reindex(input.id);
    });
    tx();
    return this.get(input.id)!;
  }

  syncDocuments(inputs: KnowledgeDocumentSyncInput[]): { synced: number; deactivated: number } {
    const syncableInputs = inputs.filter((input) => this.isSyncableDocumentChange(input));
    const activeDocumentIds = new Set(syncableInputs.map((input) => input.item.id));
    const tx = this.db.transaction(() => {
      for (const input of syncableInputs) this.upsertDocumentKnowledge(input);
      /**
       * 文档已经成为长期知识的唯一权威源；启动同步前遗留在数据库里的 active 状态可能来自旧版本审批流程，
       * 也可能是上一次同步出的文档投影但本次文档已删除、移动或改 ID。同步必须以本次扫描集合为准收敛运行时，
       * 否则旧数据库投影会绕过 PR 和仓库历史继续污染 prompt 注入。
       */
      const params = Array.from(activeDocumentIds);
      const where = params.length ? `AND id NOT IN (${params.map(() => "?").join(", ")})` : "";
      this.db.prepare(`UPDATE knowledge_item SET runtime_state = 'inactive', updated_at = datetime('now') WHERE status = 'active' AND document_path IS NULL ${where}`).run(...params);
      this.db.prepare(`UPDATE knowledge_item SET runtime_state = 'inactive', updated_at = datetime('now') WHERE document_path IS NOT NULL ${where}`).run(...params);
      this.db.prepare(`DELETE FROM knowledge_search WHERE knowledge_id IN (SELECT id FROM knowledge_item WHERE status = 'active' AND runtime_state != 'active')`).run();
      this.db.prepare(`DELETE FROM knowledge_usage_policy WHERE knowledge_id IN (SELECT id FROM knowledge_item WHERE document_path IS NOT NULL AND runtime_state != 'active')`).run();
      for (const input of syncableInputs) this.markChangeRequestSynced(input);
    });
    tx();
    const deactivated = (this.db.prepare("SELECT COUNT(*) as count FROM knowledge_item WHERE status = 'active' AND runtime_state = 'inactive'").get() as { count: number }).count;
    return { synced: syncableInputs.length, deactivated };
  }

  createChangeRequest(input: CreateKnowledgeChangeRequestInput): KnowledgeChangeRequest {
    this.db.prepare(`INSERT INTO knowledge_change_request (id, type, request_state, pr_state, runtime_state, candidate_id, knowledge_id, target_knowledge_id, document_path, branch_name, worktree_path, pr_url, pr_number, expected_document_hash, created_by, approved_by, metadata) VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.type, input.prUrl ? "open" : "none", input.prUrl ? "pending_restart" : "not_applicable", input.candidateId ?? null, input.knowledgeId ?? null, input.targetKnowledgeId ?? null, input.documentPath ?? null, input.branchName ?? null, input.worktreePath ?? null, input.prUrl ?? null, input.prNumber ?? null, input.expectedDocumentHash ?? null, input.createdBy ?? null, input.approvedBy ?? null, input.metadata ?? null);
    this.insertChangeRequestEvent({ requestId: input.id, eventType: "created", actor: input.createdBy ?? null, prUrl: input.prUrl ?? null, documentPath: input.documentPath ?? null, documentHash: input.expectedDocumentHash ?? null, payload: input.metadata ?? null });
    return this.getChangeRequest(input.id)!;
  }

  listChangeRequests(): KnowledgeChangeRequest[] {
    return this.db.prepare("SELECT * FROM knowledge_change_request ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC").all() as KnowledgeChangeRequest[];
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
      /**
       * 批准只代表候选已被允许进入“生成文档 PR”的工作流，不再代表长期知识 active。
       * 真正 active 只能由 docs/knowledge 在启动同步时投影出来，避免数据库状态绕过代码审查成为权威源。
       */
      this.db.prepare(`UPDATE knowledge_item SET title = ?, content = ?, rationale = ?, scope_type = ?, scope_ref = ?, kind = ?, governance_level = ?, status = 'pending_document', approved_by = ?, approved_at = datetime('now'), metadata = ?, updated_at = datetime('now') WHERE id = ?`).run(updates.title ?? before.title, updates.content ?? before.content, updates.rationale ?? before.rationale, updates.scope_type ?? before.scope_type, updates.scope_ref ?? before.scope_ref, updates.kind ?? before.kind, updates.governance_level ?? (before.governance_level === "L0" ? "L1" : before.governance_level), input.reviewer, updates.metadata ?? before.metadata, id);
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
    const knowledge = this.mustGet(knowledgeId);
    if (knowledge.document_path) throw new Error("Document-backed knowledge policy must be changed through a knowledge document PR");
    if (knowledge.status === "pending_document") throw new Error("Approved knowledge waiting for document landing must be changed through its knowledge document PR");
    return this.upsertPolicyInternal(knowledgeId, input);
  }

  private upsertPolicyInternal(knowledgeId: string, input: KnowledgeUsagePolicyInput): KnowledgeUsagePolicy {
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
    const rows = this.db.prepare(`SELECT k.* FROM knowledge_item k JOIN knowledge_usage_policy p ON p.knowledge_id = k.id WHERE k.status = 'active' AND k.runtime_state = 'active' AND p.allow_prompt_injection = 1 AND p.prompt_mode != 'none' AND (p.stage_types = '[]' OR EXISTS (SELECT 1 FROM json_each(p.stage_types) WHERE value = ?)) AND (p.snail_names = '[]' OR EXISTS (SELECT 1 FROM json_each(p.snail_names) WHERE value = ?)) AND (k.scope_type = 'global' OR (k.scope_type = 'project' AND k.scope_ref = ?) OR (k.scope_type = 'feature' AND k.scope_ref = ?) OR (k.scope_type = 'stage_type' AND k.scope_ref = ?) OR (k.scope_type = 'snail' AND k.scope_ref = ?) OR (k.scope_type = 'workflow')) ORDER BY p.priority DESC, datetime(k.updated_at) DESC LIMIT ?`).all(input.stageType, input.snailName, input.projectId, input.featureId, input.stageType, input.snailName, input.limit ?? 8) as KnowledgeItem[];
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

  private transition(input: TransitionInput): KnowledgeWithDetails {
    const before = this.mustGet(input.id);
    if (before.document_path) throw new Error("Document-backed knowledge status must be changed through a knowledge document PR");
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

  private upsertDocumentKnowledge(input: KnowledgeDocumentSyncInput): void {
    const item = input.item;
    const governanceLevel = item.governanceLevel ?? "L1";
    this.db.prepare(`INSERT INTO knowledge_item (id, project_id, scope_type, scope_ref, kind, status, governance_level, title, content, rationale, created_by, approved_by, approved_at, metadata, document_path, document_hash, runtime_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active') ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, scope_type = excluded.scope_type, scope_ref = excluded.scope_ref, kind = excluded.kind, status = excluded.status, governance_level = excluded.governance_level, title = excluded.title, content = excluded.content, rationale = excluded.rationale, created_by = excluded.created_by, approved_by = excluded.approved_by, approved_at = excluded.approved_at, metadata = excluded.metadata, document_path = excluded.document_path, document_hash = excluded.document_hash, runtime_state = 'active', updated_at = datetime('now')`).run(item.id, item.projectId ?? null, item.scopeType, item.scopeRef ?? null, item.kind, item.status, governanceLevel, item.title, item.content, item.rationale ?? null, item.createdBy ?? null, item.approvedBy ?? null, item.approvedAt ?? null, item.metadata ?? null, input.documentPath, input.documentHash);
    this.db.prepare("DELETE FROM knowledge_source WHERE knowledge_id = ?").run(item.id);
    for (const source of item.sources ?? []) this.db.prepare("INSERT INTO knowledge_source (id, knowledge_id, source_type, source_id, quote) VALUES (?, ?, ?, ?, ?)").run(source.id, item.id, source.sourceType, source.sourceId, source.quote ?? null);
    if (input.usagePolicy) this.upsertPolicyInternal(item.id, input.usagePolicy);
    else this.db.prepare("DELETE FROM knowledge_usage_policy WHERE knowledge_id = ?").run(item.id);
    this.reindex(item.id);
  }

  private markChangeRequestSynced(input: KnowledgeDocumentSyncInput): void {
    if (!input.changeRequestId) return;
    const request = this.getChangeRequest(input.changeRequestId);
    if (!request) return;
    const hashMatches = !request.expected_document_hash || request.expected_document_hash === input.documentHash;
    const requestState = hashMatches ? "completed" : "failed";
    const runtimeState = hashMatches ? "active" : "failed";
    const errorMessage = hashMatches ? null : "knowledge document hash does not match the expected PR payload";
    this.db.prepare("UPDATE knowledge_change_request SET request_state = ?, runtime_state = ?, synced_document_hash = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?").run(requestState, runtimeState, input.documentHash, errorMessage, input.changeRequestId);
    this.insertChangeRequestEvent({ requestId: input.changeRequestId, eventType: hashMatches ? "sync_completed" : "sync_failed", actor: "startup-sync", prUrl: request.pr_url, documentPath: input.documentPath, documentHash: input.documentHash, payload: errorMessage });
  }

  private isSyncableDocumentChange(input: KnowledgeDocumentSyncInput): boolean {
    if (!input.changeRequestId) return true;
    const request = this.getChangeRequest(input.changeRequestId);
    if (!request) return true;
    if (request.pr_state === "merged") return true;
    this.insertChangeRequestEvent({ requestId: input.changeRequestId, eventType: "sync_skipped", actor: "startup-sync", prUrl: request.pr_url, documentPath: input.documentPath, documentHash: input.documentHash, payload: "knowledge document change request is not merged" });
    return false;
  }

  private getChangeRequest(id: string): KnowledgeChangeRequest | null {
    return this.db.prepare("SELECT * FROM knowledge_change_request WHERE id = ?").get(id) as KnowledgeChangeRequest | undefined ?? null;
  }

  private insertChangeRequestEvent(input: ChangeRequestEventInput): void {
    this.db.prepare("INSERT INTO knowledge_change_request_event (id, request_id, event_type, actor, pr_url, commit_sha, document_path, document_hash, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(`${input.requestId}:event:${Date.now()}:${Math.random()}`, input.requestId, input.eventType, input.actor ?? null, input.prUrl ?? null, input.commitSha ?? null, input.documentPath ?? null, input.documentHash ?? null, input.payload ?? null);
  }
}

interface ChangeRequestEventInput {
  requestId: string;
  eventType: string;
  actor?: string | null;
  prUrl?: string | null;
  commitSha?: string | null;
  documentPath?: string | null;
  documentHash?: string | null;
  payload?: string | null;
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
