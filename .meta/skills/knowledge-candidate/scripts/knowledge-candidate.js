#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/bin/knowledge-candidate.ts
var import_fs = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));
var import_crypto = require("crypto");

// src/persistence/store.ts
var import_better_sqlite3 = __toESM(require("better-sqlite3"));
var import_path = __toESM(require("path"));

// src/persistence/helpers.ts
function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function parseJsonRecord(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) return {};
    const record = {};
    for (const [k, v] of Object.entries(parsed)) {
      record[k] = String(v);
    }
    return record;
  } catch {
    return {};
  }
}
function mapStage(row) {
  const { input_artifacts: _ignoredInputArtifacts, ...stageRow } = row;
  return {
    ...stageRow,
    output_artifacts: parseJsonRecord(row.output_artifacts)
  };
}
function mapConversation(row) {
  return {
    ...row,
    participating_roles: parseJsonArray(row.participating_roles),
    from_conversation_ids: parseJsonArray(row.from_conversation_ids)
  };
}
function mapMessage(row) {
  return {
    ...row,
    to_roles: parseJsonArray(row.to_roles),
    runtime: row.runtime
  };
}
function mapMessageContext(row) {
  return row;
}
function mapKnowledgeGovernance(row, conversation = null) {
  return {
    ...row,
    related_knowledge_ids: parseJsonArray(row.related_knowledge_ids),
    runtime_feedback_allowed: Boolean(row.runtime_feedback_allowed),
    runtime_feedback_channels: parseJsonArray(row.runtime_feedback_channels),
    conversation
  };
}
function defaultEventSource(source = {}) {
  return {
    runtime_name: source.runtime_name ?? null,
    runtime_event_type: source.runtime_event_type ?? null,
    runtime_message_id: source.runtime_message_id ?? null,
    runtime_item_id: source.runtime_item_id ?? null,
    runtime_call_id: source.runtime_call_id ?? null,
    raw_event: source.raw_event ?? null,
    metadata: source.metadata ?? null
  };
}
function eventCategoryForKind(kind) {
  return kind === "start" || kind === "signal" || kind === "error" ? "signal" : "content";
}
function serializeMessageEventPayload(payload) {
  return JSON.stringify(payload);
}
function deserializeMessageEventPayload(value) {
  return JSON.parse(value);
}
function serializeMessageEventSource(source) {
  return JSON.stringify(source);
}
function deserializeMessageEventSource(value) {
  return defaultEventSource(JSON.parse(value));
}
function mapMessageEvent(row) {
  return {
    id: row.id,
    message_id: row.message_id,
    seq: row.seq,
    category: row.category,
    kind: row.kind,
    payload: deserializeMessageEventPayload(row.payload),
    source: deserializeMessageEventSource(row.source),
    created_at: row.created_at
  };
}
function buildFtsQuery(query) {
  const tokens = query.trim().split(/\s+/).map((token) => token.replace(/"/g, '""').trim()).filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((token) => `"${token}"`).join(" AND ");
}
function normalizeSnippet(snippet) {
  return snippet.replace(/\s+/g, " ").trim();
}
function buildSearchableMessageContent(_role, context, events) {
  const normalizedContext = context?.context?.trim();
  if (normalizedContext) return normalizedContext;
  return events.flatMap(extractSearchableEventText).filter(Boolean).join("\n\n").trim();
}
function extractSearchableEventText(event) {
  switch (event.kind) {
    case "text":
      return [event.payload.text];
    case "content_block": {
      const payload = event.payload;
      return [payload.fallback_text ?? "", ...payload.blocks.flatMap(extractSearchableBlockText)];
    }
    case "tool_result": {
      const payload = event.payload;
      return [payload.output_text ?? "", payload.is_error ? payload.error_text ?? "" : ""];
    }
    case "command_result": {
      const payload = event.payload;
      return [payload.output_text ?? ""];
    }
    case "error":
      return [event.payload.message];
    default:
      return [];
  }
}
function extractSearchableBlockText(block) {
  switch (block.type) {
    case "text":
    case "rich_text":
    case "markdown":
      return [block.text];
    case "question":
      return [block.title, block.question, block.reason ?? "", ...block.options.flatMap((option) => [option.label, option.description ?? ""])];
    case "question_response":
      return [block.summary, ...block.selected_options.flatMap((option) => [option.label, option.extra_text ?? ""])];
    case "image":
      return [block.alt ?? ""];
    case "icon":
      return [block.label ?? block.name];
    case "chart":
      return [block.title ?? ""];
    case "table":
      return [block.title ?? "", block.columns.join(" ")];
    case "tool_call_card":
      return [block.summary ?? block.detail ?? block.tool_name];
    case "artifact_card":
      return [block.title, block.summary ?? ""];
    case "reference_card":
      return [block.title, block.summary ?? ""];
  }
}
function attachMessageEvents(messages, getMessageEvents, getMessageContext3 = () => null) {
  return messages.map((message) => ({
    ...message,
    events: getMessageEvents(message.id),
    context: getMessageContext3(message.id)
  }));
}

// src/persistence/knowledge-model.ts
var KnowledgeModel = class {
  constructor(db) {
    this.db = db;
  }
  db;
  create(input) {
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
    return this.get(input.id);
  }
  get(id) {
    const item = this.db.prepare("SELECT * FROM knowledge_item WHERE id = ?").get(id);
    return item ? this.withDetails(item) : null;
  }
  list(filters = {}) {
    if (filters.query?.trim()) return this.search(filters);
    const query = buildKnowledgeListQuery(filters);
    const rows = this.db.prepare(query.sql).all(...query.params, filters.limit ?? 50, filters.offset ?? 0);
    return rows.map((item) => ({ ...toSearchResult(item), governance: this.governance(item.id) }));
  }
  search(filters) {
    const query = buildKnowledgeSearchQuery(filters);
    const rows = this.db.prepare(query.sql).all(...query.params, filters.limit ?? 50, filters.offset ?? 0);
    return rows.map((item) => ({ ...toSearchResultWithSnippet(item), governance: this.governance(item.id) }));
  }
  approve(id, input) {
    const before = this.mustGet(id);
    const updates = input.updates ?? {};
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE knowledge_item SET title = ?, content = ?, rationale = ?, scope_type = ?, scope_ref = ?, kind = ?, governance_level = ?, status = 'active', approved_by = ?, approved_at = datetime('now'), metadata = ?, updated_at = datetime('now') WHERE id = ?`).run(updates.title ?? before.title, updates.content ?? before.content, updates.rationale ?? before.rationale, updates.scope_type ?? before.scope_type, updates.scope_ref ?? before.scope_ref, updates.kind ?? before.kind, updates.governance_level ?? (before.governance_level === "L0" ? "L1" : before.governance_level), input.reviewer, updates.metadata ?? before.metadata, id);
      this.insertReview({ id, reviewer: input.reviewer, decision: "approve", comment: input.comment ?? null, before });
      this.reindex(id);
    });
    tx();
    return this.get(id);
  }
  reject(id, reviewer, comment) {
    return this.transition({ id, status: "rejected", reviewer, decision: "reject", comment: comment ?? null });
  }
  archive(id, reviewer, comment) {
    return this.transition({ id, status: "archived", reviewer, decision: "archive", comment: comment ?? null });
  }
  deprecate(id, reviewer, comment) {
    return this.transition({ id, status: "deprecated", reviewer, decision: "deprecate", comment: comment ?? null });
  }
  sources(knowledgeId) {
    return this.db.prepare("SELECT * FROM knowledge_source WHERE knowledge_id = ? ORDER BY datetime(created_at) ASC").all(knowledgeId);
  }
  recordUse(input) {
    this.db.prepare("INSERT INTO knowledge_use (id, knowledge_id, conversation_id, stage_id, role_name, use_type, outcome, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.knowledgeId, input.conversationId ?? null, input.stageId ?? null, input.roleName ?? null, input.useType, input.outcome ?? null, input.feedback ?? null);
    return this.db.prepare("SELECT * FROM knowledge_use WHERE id = ?").get(input.id);
  }
  governance(knowledgeId) {
    const row = this.db.prepare("SELECT * FROM knowledge_governance WHERE knowledge_id = ?").get(knowledgeId);
    return row ? this.withGovernanceConversation(row) : null;
  }
  getGovernance(id) {
    const row = this.db.prepare("SELECT * FROM knowledge_governance WHERE id = ?").get(id);
    return row ? this.withGovernanceConversation(row) : null;
  }
  listGovernance(limit = 50, offset = 0) {
    const rows = this.db.prepare("SELECT * FROM knowledge_governance ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?").all(limit, offset);
    return rows.map((row) => this.withGovernanceConversation(row));
  }
  updateGovernance(id, input) {
    const current = this.getGovernance(id);
    if (!current) throw new Error(`Knowledge governance not found: ${id}`);
    const dispositionStatus = input.dispositionStatus ?? current.disposition_status;
    const closedAt = ["conclusion_only", "pr_merged", "landed", "reference_only", "merged_or_superseded", "closed", "deferred"].includes(dispositionStatus) ? "datetime('now')" : "NULL";
    this.db.prepare(`UPDATE knowledge_governance SET entry_check_status = ?, dedupe_status = ?, scenario_type = ?, disposition_status = ?, artifact_type = ?, related_knowledge_ids = ?, final_destination = ?, governance_pr_url = ?, disposition_reason = ?, deferred_reason = ?, retrigger_condition = ?, runtime_feedback_allowed = ?, runtime_feedback_channels = ?, closed_at = ${closedAt}, updated_at = datetime('now') WHERE id = ?`).run(input.entryCheckStatus ?? current.entry_check_status, input.dedupeStatus ?? current.dedupe_status, input.scenarioType ?? current.scenario_type, dispositionStatus, input.artifactType ?? current.artifact_type, JSON.stringify(input.relatedKnowledgeIds ?? current.related_knowledge_ids), input.finalDestination ?? current.final_destination, input.governancePrUrl ?? current.governance_pr_url, input.dispositionReason ?? current.disposition_reason, input.deferredReason ?? current.deferred_reason, input.retriggerCondition ?? current.retrigger_condition, input.runtimeFeedbackAllowed ?? current.runtime_feedback_allowed ? 1 : 0, JSON.stringify(input.runtimeFeedbackChannels ?? current.runtime_feedback_channels), id);
    return this.getGovernance(id);
  }
  uses(knowledgeId, limit = 50, offset = 0) {
    return this.db.prepare("SELECT * FROM knowledge_use WHERE knowledge_id = ? ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?").all(knowledgeId, limit, offset);
  }
  withDetails(item) {
    return { ...item, sources: this.sources(item.id), use_count: this.useCount(item.id), governance: this.governance(item.id) };
  }
  createGovernanceShell(knowledgeId, title) {
    const governanceId = `${knowledgeId}:governance`;
    const conversationId = `${governanceId}:conversation`;
    const featureId = `${knowledgeId}:feature`;
    const stageId = `${knowledgeId}:stage`;
    this.db.prepare("INSERT INTO knowledge_governance (id, knowledge_id) VALUES (?, ?)").run(governanceId, knowledgeId);
    this.db.prepare("INSERT INTO feature (id, project_id, title, summary, status) VALUES (?, 'knowledge-center', ?, ?, 'active')").run(featureId, `\u77E5\u8BC6\u6CBB\u7406\uFF1A${title}`, "\u56F4\u7ED5\u5355\u6761\u5019\u9009\u77E5\u8BC6\u5B8C\u6210\u5165\u53E3\u6821\u9A8C\u3001\u67E5\u91CD\u5B9A\u6027\u3001\u88C1\u51B3\u53BB\u5411\u548C\u5FC5\u8981 PR \u5904\u7406");
    this.db.prepare("INSERT INTO stage (id, project_id, feature_id, stage_definition_id, type, sequence, status) VALUES (?, 'knowledge-center', ?, 'knowledge-center-development', 'development', 1, 'in_progress')").run(stageId, featureId);
    this.db.prepare("INSERT INTO conversation (id, owner_type, owner_id, project_id, feature_id, stage_id, title, kind, status, default_role, participating_roles, summary) VALUES (?, 'knowledge_governance', ?, 'knowledge-center', ?, ?, ?, 'discussion', 'active', ?, ?, ?)").run(conversationId, governanceId, featureId, stageId, `\u77E5\u8BC6\u6CBB\u7406\uFF1A${title}`, "\u77E5\u8BC6\u6267\u884C\u8005", JSON.stringify(["Boss Role", "\u77E5\u8BC6\u6267\u884C\u8005"]), "Auto-created governance conversation for knowledge candidate");
  }
  withGovernanceConversation(row) {
    const conversationRow = this.db.prepare("SELECT * FROM conversation WHERE owner_type = 'knowledge_governance' AND owner_id = ? ORDER BY datetime(created_at) ASC LIMIT 1").get(String(row.id));
    return mapKnowledgeGovernance(row, conversationRow ? mapConversation(conversationRow) : null);
  }
  useCount(knowledgeId) {
    return this.db.prepare("SELECT COUNT(*) as count FROM knowledge_use WHERE knowledge_id = ?").get(knowledgeId).count;
  }
  mustGet(id) {
    const item = this.get(id);
    if (!item) throw new Error(`Knowledge not found: ${id}`);
    return item;
  }
  transition(input) {
    const before = this.mustGet(input.id);
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE knowledge_item SET status = ?, updated_at = datetime('now') WHERE id = ?").run(input.status, input.id);
      this.insertReview({ ...input, before });
      this.reindex(input.id);
    });
    tx();
    return this.get(input.id);
  }
  insertReview(input) {
    const after = this.db.prepare("SELECT * FROM knowledge_item WHERE id = ?").get(input.id);
    this.db.prepare("INSERT INTO knowledge_candidate_review (id, knowledge_id, reviewer, decision, comment, before_snapshot, after_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)").run(`${input.id}:review:${Date.now()}`, input.id, input.reviewer, input.decision, input.comment, JSON.stringify(input.before), JSON.stringify(after));
  }
  reindex(knowledgeId) {
    const item = this.db.prepare("SELECT * FROM knowledge_item WHERE id = ?").get(knowledgeId);
    this.db.prepare("DELETE FROM knowledge_search WHERE knowledge_id = ?").run(knowledgeId);
    if (!item) return;
    const sourceQuote = this.sources(knowledgeId).map((source) => source.quote ?? "").filter(Boolean).join("\n");
    this.db.prepare("INSERT INTO knowledge_search (knowledge_id, project_id, scope_type, kind, status, title, content, source_quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(item.id, item.project_id, item.scope_type, item.kind, item.status, item.title, item.content, sourceQuote);
  }
};
function toSearchResult(item) {
  return { id: item.id, project_id: item.project_id, scope_type: item.scope_type, scope_ref: item.scope_ref, kind: item.kind, status: item.status, governance_level: item.governance_level, title: item.title, content: item.content, snippet: item.content.slice(0, 240), governance: null, updated_at: item.updated_at };
}
function toSearchResultWithSnippet(item) {
  return { ...toSearchResult(item), snippet: normalizeSnippet(item.snippet) };
}
function buildKnowledgeListQuery(filters) {
  const built = buildWhere(filters, "");
  return { sql: `SELECT * FROM knowledge_item ${built.where} ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?`, params: built.params };
}
function buildKnowledgeSearchQuery(filters) {
  const built = buildWhere(filters, "k.");
  const where = ["knowledge_search MATCH ?", ...built.clauses].join(" AND ");
  return { sql: `SELECT k.*, snippet(knowledge_search, 5, '[', ']', '...', 24) AS snippet FROM knowledge_search JOIN knowledge_item k ON k.id = knowledge_search.knowledge_id WHERE ${where} ORDER BY rank, datetime(k.updated_at) DESC LIMIT ? OFFSET ?`, params: [buildFtsQuery(filters.query ?? ""), ...built.params] };
}
function buildWhere(filters, prefix) {
  const clauses = [];
  const params = [];
  addNullableClause(clauses, params, `${prefix}project_id`, filters.projectId);
  addClause(clauses, params, `${prefix}scope_type`, filters.scopeType);
  addClause(clauses, params, `${prefix}scope_ref`, filters.scopeRef);
  addClause(clauses, params, `${prefix}kind`, filters.kind);
  addClause(clauses, params, `${prefix}status`, filters.status);
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", clauses, params };
}
function addClause(clauses, params, field, value) {
  if (value === void 0 || value === null || value === "") return;
  clauses.push(`${field} = ?`);
  params.push(value);
}
function addNullableClause(clauses, params, field, value) {
  if (value === void 0) return;
  if (value === null) clauses.push(`${field} IS NULL`);
  else addClause(clauses, params, field, value);
}

// src/persistence/design-decision-model.ts
var DesignDecisionModel = class {
  constructor(db) {
    this.db = db;
  }
  db;
  create(input) {
    const status = input.status ?? "active";
    this.db.prepare(`INSERT INTO design_decision (id, project_id, scope_type, scope_ref, title, content, status, source_knowledge_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.projectId ?? null, input.scopeType, input.scopeRef ?? null, input.title, input.content, status, input.sourceKnowledgeId ?? null);
    this.reindex(input.id);
    return this.mustGet(input.id);
  }
  get(id) {
    return this.db.prepare("SELECT * FROM design_decision WHERE id = ?").get(id) ?? null;
  }
  list(filters = {}) {
    if (filters.query?.trim()) return this.search(filters);
    const built = buildWhere2(filters);
    const rows = this.db.prepare(`SELECT * FROM design_decision ${built.where} ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?`).all(...built.params, filters.limit ?? 50, filters.offset ?? 0);
    return rows.map(toSearchResult2);
  }
  search(filters) {
    const built = buildWhere2(filters, "d.");
    const where = ["design_decision_search MATCH ?", ...built.clauses].join(" AND ");
    const rows = this.db.prepare(`SELECT d.*, snippet(design_decision_search, 4, '[', ']', '...', 24) AS snippet FROM design_decision_search JOIN design_decision d ON d.id = design_decision_search.decision_id WHERE ${where} ORDER BY rank, datetime(d.updated_at) DESC LIMIT ? OFFSET ?`).all(buildFtsQuery(filters.query ?? ""), ...built.params, filters.limit ?? 50, filters.offset ?? 0);
    return rows.map((row) => ({ ...toSearchResult2(row), snippet: normalizeSnippet(row.snippet) }));
  }
  update(id, updates) {
    const current = this.mustGet(id);
    this.db.prepare(`UPDATE design_decision SET title = ?, content = ?, status = ?, scope_type = ?, scope_ref = ?, project_id = ?, updated_at = datetime('now') WHERE id = ?`).run(updates.title ?? current.title, updates.content ?? current.content, updates.status ?? current.status, updates.scopeType ?? current.scope_type, updates.scopeRef ?? current.scope_ref, updates.projectId ?? current.project_id, id);
    this.reindex(id);
    return this.mustGet(id);
  }
  deprecate(id) {
    return this.update(id, { status: "deprecated" });
  }
  mustGet(id) {
    const item = this.get(id);
    if (!item) throw new Error(`Design decision not found: ${id}`);
    return item;
  }
  reindex(decisionId) {
    const item = this.get(decisionId);
    this.db.prepare("DELETE FROM design_decision_search WHERE decision_id = ?").run(decisionId);
    if (!item) return;
    this.db.prepare("INSERT INTO design_decision_search (decision_id, project_id, scope_type, status, title, content) VALUES (?, ?, ?, ?, ?, ?)").run(item.id, item.project_id, item.scope_type, item.status, item.title, item.content);
  }
};
function toSearchResult2(item) {
  return { id: item.id, project_id: item.project_id, scope_type: item.scope_type, scope_ref: item.scope_ref, title: item.title, content: item.content, snippet: item.content.slice(0, 240), status: item.status, source_knowledge_id: item.source_knowledge_id, updated_at: item.updated_at };
}
function buildWhere2(filters, prefix = "") {
  const clauses = [];
  const params = [];
  addNullableClause2(clauses, params, `${prefix}project_id`, filters.projectId);
  addClause2(clauses, params, `${prefix}scope_type`, filters.scopeType);
  addClause2(clauses, params, `${prefix}scope_ref`, filters.scopeRef);
  addClause2(clauses, params, `${prefix}status`, filters.status);
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", clauses, params };
}
function addClause2(clauses, params, field, value) {
  if (value === void 0 || value === null || value === "") return;
  clauses.push(`${field} = ?`);
  params.push(value);
}
function addNullableClause2(clauses, params, field, value) {
  if (value === void 0) return;
  if (value === null) clauses.push(`${field} IS NULL`);
  else addClause2(clauses, params, field, value);
}

// src/persistence/dispatch-store.ts
function markProjectDispatchesConsumed(db, dispatchIds, consumedByMessageId = null) {
  updateProjectDispatchStatus(db, dispatchIds, "consumed", consumedByMessageId);
}
function markProjectDispatchesSeen(db, dispatchIds) {
  updateProjectDispatchStatus(db, dispatchIds, "seen");
}
function skipProjectDispatches(db, dispatchIds) {
  updateProjectDispatchStatus(db, dispatchIds, "skipped");
}
function listProjectBossPendingDispatches(db, conversationId) {
  return db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_role = 'Boss Role' AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId);
}
function updateProjectDispatchStatus(db, dispatchIds, status, consumedByMessageId = null) {
  if (dispatchIds.length === 0) return;
  const placeholders = dispatchIds.map(() => "?").join(", ");
  db.prepare(`UPDATE message_dispatch SET status = ?, consumed_by_message_id = ?, consumed_at = datetime('now') WHERE id IN (${placeholders})`).run(status, consumedByMessageId, ...dispatchIds);
}

// src/persistence/message-read-model.ts
function getRecentMessagesSnapshot(input) {
  const transaction = input.db.transaction(() => {
    const snapshotEventId = getLastMessageEventId(input.db, input.conversationId);
    input.beforeCursorHook?.(snapshotEventId);
    const rows = input.db.prepare(
      `SELECT * FROM message
       WHERE conversation_id = ?
         AND (id IN (SELECT id FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?)
           OR status = 'streaming')
       ORDER BY datetime(created_at) ASC, id ASC`
    ).all(input.conversationId, input.conversationId, input.limit);
    const items = rows.map(mapMessage).map((message) => ({
      ...message,
      events: getMessageEventsAtOrBefore(input.db, message.id, snapshotEventId),
      context: getMessageContext(input.db, message.id)
    }));
    return { items, last_event_id: snapshotEventId };
  });
  return transaction();
}
function getMessageContext(db, messageId) {
  const row = db.prepare("SELECT * FROM message_context WHERE message_id = ?").get(messageId);
  return row ? mapMessageContext(row) : null;
}
function getLastMessageEventId(db, conversationId) {
  const row = db.prepare(
    `SELECT COALESCE(MAX(message_event.id), 0) AS id
     FROM message_event
     JOIN message ON message.id = message_event.message_id
     WHERE message.conversation_id = ?`
  ).get(conversationId);
  return row?.id ?? 0;
}
function getMessageEventsAtOrBefore(db, messageId, snapshotEventId) {
  const rows = db.prepare("SELECT * FROM message_event WHERE message_id = ? AND id <= ? ORDER BY seq ASC").all(messageId, snapshotEventId);
  return rows.map(mapMessageEvent);
}
function getMessageEventsAfter(db, conversationId, afterEventId, untilEventId = null) {
  const upperBound = Number.isInteger(untilEventId) ? "AND message_event.id <= ?" : "";
  const params = Number.isInteger(untilEventId) ? [conversationId, afterEventId, untilEventId] : [conversationId, afterEventId];
  const rows = db.prepare(
    `SELECT message_event.*, message.from_role AS message_from_role FROM message_event
     JOIN message ON message.id = message_event.message_id
     WHERE message.conversation_id = ? AND message_event.id > ? ${upperBound}
     ORDER BY message_event.id ASC`
  ).all(...params);
  return rows.map((row) => ({ ...mapMessageEvent(row), message_from_role: row.message_from_role }));
}
function getRecentMessages(input) {
  const rows = input.db.prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?").all(input.conversationId, input.limit);
  return attachMessageEvents(rows.map(mapMessage).reverse(), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}
function getLatestMessage(input) {
  const row = input.db.prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get(input.conversationId);
  if (!row) return null;
  return attachMessageEvents([mapMessage(row)], input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId))[0] ?? null;
}
function getLatestRespondingRole(input) {
  const candidates = input.participatingRoles.filter((roleName) => roleName !== "Boss Role");
  if (candidates.length === 0) return null;
  const placeholders = candidates.map(() => "?").join(", ");
  const row = input.db.prepare(
    `SELECT from_role FROM message
     WHERE conversation_id = ?
       AND role = 'assistant'
       AND from_role IS NOT NULL
       AND from_role IN (${placeholders})
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 1`
  ).get(input.conversationId, ...candidates);
  return row?.from_role ?? null;
}
function getMessagesSinceRoleReply(input) {
  const lastSnailReply = input.db.prepare("SELECT id FROM message WHERE conversation_id = ? AND role = 'assistant' AND from_role = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get(input.conversationId, input.roleName);
  const rows = lastSnailReply ? input.db.prepare("SELECT * FROM message WHERE conversation_id = ? AND id > ? ORDER BY datetime(created_at) ASC, id ASC").all(input.conversationId, lastSnailReply.id) : input.db.prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(input.conversationId);
  return attachMessageEvents(rows.map(mapMessage), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}
function getDispatchInboxMessages(input) {
  const uniqueSourceIds = [...new Set(input.dispatchSourceMessageIds.filter(Number.isInteger))];
  const sourcePlaceholders = uniqueSourceIds.map(() => "?").join(", ");
  const lastSnailReply = input.db.prepare(
    "SELECT id, context_cutoff_at FROM message WHERE conversation_id = ? AND role = 'assistant' AND from_role = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1"
  ).get(input.conversationId, input.roleName);
  const cutoff = buildDispatchInboxCutoff(lastSnailReply);
  const sourcePredicate = uniqueSourceIds.length > 0 ? ` OR id IN (${sourcePlaceholders})` : "";
  const params = [input.conversationId, ...cutoff.params, ...uniqueSourceIds];
  const rows = input.db.prepare(
    `SELECT * FROM message
     WHERE conversation_id = ?
       AND (${cutoff.predicate}${sourcePredicate})
     ORDER BY datetime(created_at) ASC, id ASC`
  ).all(...params);
  return attachMessageEvents(rows.map(mapMessage), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}
function buildDispatchInboxCutoff(lastSnailReply) {
  if (!lastSnailReply) return { predicate: "1 = 1", params: [] };
  const cutoffValue = lastSnailReply.context_cutoff_at ?? "";
  if (!/^\d+$/.test(cutoffValue)) {
    throw new Error(`Invalid context_cutoff_at cutoff message id for message ${lastSnailReply.id}: ${cutoffValue}`);
  }
  const cutoffMessageId = Number(cutoffValue);
  if (!Number.isSafeInteger(cutoffMessageId)) {
    throw new Error(`Unsafe context_cutoff_at cutoff message id for message ${lastSnailReply.id}: ${cutoffValue}`);
  }
  return { predicate: "(id > ? AND id != ?)", params: [cutoffMessageId, lastSnailReply.id] };
}
function getMessagesByIds(input) {
  if (input.messageIds.length === 0) return [];
  const placeholders = input.messageIds.map(() => "?").join(", ");
  const rows = input.db.prepare(`SELECT * FROM message WHERE conversation_id = ? AND id IN (${placeholders}) ORDER BY datetime(created_at) ASC, id ASC`).all(input.conversationId, ...input.messageIds);
  return attachMessageEvents(rows.map(mapMessage), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}
function getMessageWindow(input) {
  const anchor = input.db.prepare("SELECT id FROM message WHERE conversation_id = ? AND id = ?").get(input.conversationId, input.anchorMessageId);
  if (!anchor) return [];
  const rows = input.db.prepare("SELECT * FROM message WHERE conversation_id = ? AND id BETWEEN ? AND ? ORDER BY datetime(created_at) ASC, id ASC").all(input.conversationId, input.anchorMessageId - input.before, input.anchorMessageId + input.after);
  return attachMessageEvents(rows.map(mapMessage), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}
function searchConversationMessages(input) {
  const trimmedQuery = input.query.trim();
  if (!trimmedQuery) return [];
  const rows = input.db.prepare(
    `SELECT message.id as message_id, message.role as role, message.from_role as from_role, message.created_at as created_at, snippet(message_search, 4, '', '', '...', 18) as snippet
     FROM message_search JOIN message ON message.id = CAST(message_search.message_id AS INTEGER)
     WHERE message_search.conversation_id = ? AND message_search MATCH ?
     ORDER BY bm25(message_search), datetime(message.created_at) DESC, message.id DESC LIMIT ? OFFSET ?`
  ).all(input.conversationId, buildFtsQuery(trimmedQuery), input.limit, input.offset);
  return rows.map((row) => ({ ...row, snippet: normalizeSnippet(row.snippet) }));
}

// src/persistence/message-context-model.ts
function upsertMessageContext(input) {
  input.db.prepare(
    `INSERT INTO message_context (message_id, kind, context, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(message_id) DO UPDATE SET kind = excluded.kind, context = excluded.context, updated_at = datetime('now')`
  ).run(input.messageId, input.kind, input.context);
  return getMessageContext2(input.db, input.messageId);
}
function getMessageContext2(db, messageId) {
  const row = db.prepare("SELECT * FROM message_context WHERE message_id = ?").get(messageId);
  return row ? mapMessageContext(row) : null;
}

// src/persistence/migrations.ts
function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}
function ensureFeatureTaskAnchorColumn(db) {
  if (!tableExists(db, "feature")) return;
  const columns = db.prepare("PRAGMA table_info(feature)").all();
  if (!columns.some((column) => column.name === "task_anchor")) {
    db.exec("ALTER TABLE feature ADD COLUMN task_anchor TEXT");
  }
}

// src/persistence/schema.ts
var SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    module TEXT NOT NULL DEFAULT 'project_management',
    name TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_stage_definition (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    input_description TEXT,
    output_description TEXT,
    acceptance_focus TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    UNIQUE(project_id, key),
    UNIQUE(project_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS stage_role_definition (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    stage_definition_id TEXT NOT NULL,
    snail_id TEXT NOT NULL,
    snail_template_id TEXT,
    name TEXT NOT NULL DEFAULT '',
    is_primary INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    working_rules TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_definition_id) REFERENCES project_stage_definition(id) ON DELETE CASCADE,
    UNIQUE(stage_definition_id, snail_id)
  );

  CREATE TABLE IF NOT EXISTS feature (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL,
    task_anchor TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stage (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    stage_definition_id TEXT NOT NULL,
    type TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL,
    output_artifacts TEXT NOT NULL DEFAULT '{}',
    entered_at TEXT,
    left_at TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_definition_id) REFERENCES project_stage_definition(id),
    UNIQUE(feature_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS conversation (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    feature_id TEXT,
    stage_id TEXT,
    owner_type TEXT NOT NULL DEFAULT 'project_stage',
    owner_id TEXT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    default_role TEXT NOT NULL,
    participating_roles TEXT NOT NULL DEFAULT '[]',
    summary TEXT,
    from_conversation_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    client_id TEXT,
    from_role TEXT,
    to_roles TEXT NOT NULL DEFAULT '[]',
    role TEXT NOT NULL,
    quoted_message_id INTEGER,
    context_cutoff_at TEXT NOT NULL DEFAULT '0',
    runtime TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE,
    FOREIGN KEY (quoted_message_id) REFERENCES message(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS message_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    category TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE,
    UNIQUE(message_id, seq)
  );

  CREATE TABLE IF NOT EXISTS message_context (
    message_id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    context TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message_dispatch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    to_role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    consumed_by_message_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    consumed_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE,
    FOREIGN KEY (consumed_by_message_id) REFERENCES message(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS snail_agent_session (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    runtime TEXT NOT NULL,
    model TEXT NOT NULL,
    context_provider TEXT NOT NULL,
    external_session_id TEXT,
    handoff_from_id TEXT REFERENCES snail_agent_session(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_item (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    scope_type TEXT NOT NULL,
    scope_ref TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    governance_level TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    rationale TEXT,
    created_by TEXT,
    approved_by TEXT,
    approved_at TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_source (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    quote TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_candidate_review (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    decision TEXT NOT NULL,
    comment TEXT,
    before_snapshot TEXT,
    after_snapshot TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_governance (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL UNIQUE,
    entry_check_status TEXT NOT NULL DEFAULT 'pending_entry_check',
    dedupe_status TEXT NOT NULL DEFAULT 'pending',
    scenario_type TEXT NOT NULL DEFAULT 'pending',
    disposition_status TEXT NOT NULL DEFAULT 'pending',
    artifact_type TEXT NOT NULL DEFAULT 'pending',
    related_knowledge_ids TEXT NOT NULL DEFAULT '[]',
    final_destination TEXT,
    governance_pr_url TEXT,
    disposition_reason TEXT,
    deferred_reason TEXT,
    retrigger_condition TEXT,
    runtime_feedback_allowed INTEGER NOT NULL DEFAULT 0,
    runtime_feedback_channels TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_use (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL,
    conversation_id TEXT,
    stage_id TEXT,
    role_name TEXT,
    use_type TEXT NOT NULL,
    outcome TEXT,
    feedback TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE SET NULL,
    FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS design_decision (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    scope_type TEXT NOT NULL,
    scope_ref TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    source_knowledge_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (source_knowledge_id) REFERENCES knowledge_item(id) ON DELETE SET NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
    conversation_id UNINDEXED,
    message_id UNINDEXED,
    role UNINDEXED,
    from_role UNINDEXED,
    content
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search USING fts5(
    knowledge_id UNINDEXED,
    project_id UNINDEXED,
    scope_type UNINDEXED,
    kind UNINDEXED,
    status UNINDEXED,
    title,
    content,
    source_quote
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS design_decision_search USING fts5(
    decision_id UNINDEXED,
    project_id UNINDEXED,
    scope_type UNINDEXED,
    status UNINDEXED,
    title,
    content
  );

  CREATE INDEX IF NOT EXISTS idx_feature_project_status ON feature(project_id, status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_stage_feature_sequence ON stage(feature_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_conversation_project_stage ON conversation(project_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_feature_stage ON conversation(feature_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_owner ON conversation(owner_type, owner_id);
  CREATE INDEX IF NOT EXISTS idx_message_conversation_created_at ON message(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_message_event_message_seq ON message_event(message_id, seq);
  CREATE INDEX IF NOT EXISTS idx_message_event_id ON message_event(id);
  CREATE INDEX IF NOT EXISTS idx_message_dispatch_to_status ON message_dispatch(conversation_id, to_role, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_snail_agent_session_lookup ON snail_agent_session(conversation_id, role_name, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_stage_definition_project ON project_stage_definition(project_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_stage_role_definition_stage ON stage_role_definition(stage_definition_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_project_status ON knowledge_item(project_id, status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge_item(scope_type, scope_ref, status);
  CREATE INDEX IF NOT EXISTS idx_knowledge_source_item ON knowledge_source(knowledge_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_governance_status ON knowledge_governance(entry_check_status, disposition_status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_use_item ON knowledge_use(knowledge_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_design_decision_project_status ON design_decision(project_id, status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_design_decision_scope ON design_decision(scope_type, scope_ref, status);
  CREATE INDEX IF NOT EXISTS idx_design_decision_source ON design_decision(source_knowledge_id);
`;

// src/persistence/project-config-model.ts
function seedProjectConfig(db, seed) {
  const existing = db.prepare("SELECT id FROM project WHERE id = ?").get(seed.project.id);
  if (existing) return { created: false };
  const insertProject = db.prepare("INSERT INTO project (id, kind, module, name, summary, status) VALUES (?, ?, ?, ?, ?, 'active')");
  const insertStageDef = db.prepare("INSERT INTO project_stage_definition (id, project_id, key, title, sequence, input_description, output_description, acceptance_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertRoleDef = db.prepare(
    "INSERT INTO stage_role_definition (id, project_id, stage_definition_id, snail_id, snail_template_id, name, is_primary, description, working_rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const transaction = db.transaction(() => {
    insertProject.run(seed.project.id, seed.project.kind, seed.project.module ?? "project_management", seed.project.name, seed.project.summary);
    for (const stageDef of seed.stage_definitions) {
      insertStageDef.run(stageDef.id, seed.project.id, stageDef.key, stageDef.title, stageDef.sequence, stageDef.input_description, stageDef.output_description, JSON.stringify(stageDef.acceptance_focus));
      for (const role of stageDef.roles) {
        insertRoleDef.run(
          role.id,
          seed.project.id,
          stageDef.id,
          role.name,
          role.snail_template_id,
          role.name,
          role.is_primary ? 1 : 0,
          role.description,
          JSON.stringify(role.working_rules)
        );
      }
    }
  });
  transaction();
  return { created: true };
}
function seedStageDefinitionsForProject(db, projectId, stageDefinitions) {
  const insertStageDef = db.prepare("INSERT OR IGNORE INTO project_stage_definition (id, project_id, key, title, sequence, input_description, output_description, acceptance_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertRoleDef = db.prepare(
    "INSERT OR IGNORE INTO stage_role_definition (id, project_id, stage_definition_id, snail_id, snail_template_id, name, is_primary, description, working_rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const transaction = db.transaction(() => {
    for (const stageDef of stageDefinitions) {
      insertStageDef.run(stageDef.id, projectId, stageDef.key, stageDef.title, stageDef.sequence, stageDef.input_description, stageDef.output_description, JSON.stringify(stageDef.acceptance_focus));
      for (const role of stageDef.roles) {
        insertRoleDef.run(
          role.id,
          projectId,
          stageDef.id,
          role.name,
          role.snail_template_id,
          role.name,
          role.is_primary ? 1 : 0,
          role.description,
          JSON.stringify(role.working_rules)
        );
      }
    }
  });
  transaction();
}
function getStageDefinition(db, id) {
  const row = db.prepare("SELECT * FROM project_stage_definition WHERE id = ?").get(id);
  return row ? mapStageDefinition(row) : void 0;
}
function getStageDefinitionByKey(db, projectId, key) {
  const row = db.prepare("SELECT * FROM project_stage_definition WHERE project_id = ? AND key = ?").get(projectId, key);
  return row ? mapStageDefinition(row) : void 0;
}
function listStageDefinitions(db, projectId) {
  const rows = db.prepare("SELECT * FROM project_stage_definition WHERE project_id = ? ORDER BY sequence ASC").all(projectId);
  return rows.map((row) => mapStageDefinition(row));
}
function getRoleDefinition(db, id) {
  const row = db.prepare("SELECT * FROM stage_role_definition WHERE id = ?").get(id);
  return row ? mapRoleDefinition(row) : void 0;
}
function listRoleDefinitions(db, stageDefinitionId) {
  const rows = db.prepare("SELECT * FROM stage_role_definition WHERE stage_definition_id = ? ORDER BY is_primary DESC, rowid ASC").all(stageDefinitionId);
  return rows.map((row) => mapRoleDefinition(row));
}
function listRoleDefinitionsByProject(db, projectId) {
  const rows = db.prepare("SELECT * FROM stage_role_definition WHERE project_id = ? ORDER BY is_primary DESC, rowid ASC").all(projectId);
  return rows.map((row) => mapRoleDefinition(row));
}
function listAllRoleDefinitions(db) {
  const rows = db.prepare("SELECT * FROM stage_role_definition ORDER BY project_id, is_primary DESC, rowid ASC").all();
  return rows.map((row) => ({ ...mapRoleDefinition(row), project_id: row.project_id }));
}
function parseJsonArray2(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function mapStageDefinition(row) {
  return {
    ...row,
    acceptance_focus: parseJsonArray2(row.acceptance_focus)
  };
}
function mapRoleDefinition(row) {
  return {
    ...row,
    working_rules: parseJsonArray2(row.working_rules)
  };
}

// src/persistence/store.ts
var ConversationStore = class {
  db;
  knowledge;
  designDecision;
  constructor(dbPath) {
    const resolvedPath = dbPath ?? import_path.default.join(process.cwd(), "data", "snail-shell.db");
    const dir = import_path.default.dirname(resolvedPath);
    const fs2 = require("fs");
    if (!fs2.existsSync(dir)) {
      fs2.mkdirSync(dir, { recursive: true });
    }
    this.db = new import_better_sqlite3.default(resolvedPath);
    this.knowledge = new KnowledgeModel(this.db);
    this.designDecision = new DesignDecisionModel(this.db);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
    ensureFeatureTaskAnchorColumn(this.db);
  }
  // ── Database Bootstrap ────────────────────────────────────────────
  //
  // HARD RULE: initSchema() 在系统每次启动时调用，只允许 CREATE TABLE IF NOT EXISTS /
  // CREATE INDEX IF NOT EXISTS 这类纯新建操作。
  // 严禁在 initSchema() 中添加任何数据修改、迁移、删除动作（包括 ALTER TABLE ADD COLUMN、
  // UPDATE、DELETE、DROP、table rebuild）。
  //
  // 表结构变更必须由人手工完成——SQLite 的 ALTER TABLE ADD COLUMN、表重建、
  // 数据迁移等动作一律不属于 initSchema() 的职责，代码中不保留任何自动迁移逻辑。
  //
  // 原因：initSchema() 连接的是生产数据库，任何自动执行的非新建操作都可能造成
  // 不可恢复的数据损失（2026-05-20 事故教训：worktree 中新增的 DROP TABLE 迁移
  // 在指向生产库路径时被自动触发，导致数据库被摧毁）。
  initSchema() {
    this.db.exec(SCHEMA_SQL);
  }
  // ── Project Config Seed ──────────────────────────────────────────
  seedProjectConfig(seed) {
    return seedProjectConfig(this.db, seed);
  }
  seedStageDefinitionsForProject(projectId, stageDefinitions) {
    return seedStageDefinitionsForProject(this.db, projectId, stageDefinitions);
  }
  // ── Project Stage Definition ─────────────────────────────────────
  getStageDefinition(id) {
    return getStageDefinition(this.db, id);
  }
  getStageDefinitionByKey(projectId, key) {
    return getStageDefinitionByKey(this.db, projectId, key);
  }
  listStageDefinitions(projectId) {
    return listStageDefinitions(this.db, projectId);
  }
  // ── Stage Role Definition ────────────────────────────────────────
  getRoleDefinition(id) {
    return getRoleDefinition(this.db, id);
  }
  listRoleDefinitions(stageDefinitionId) {
    return listRoleDefinitions(this.db, stageDefinitionId);
  }
  listRoleDefinitionsByProject(projectId) {
    return listRoleDefinitionsByProject(this.db, projectId);
  }
  listAllRoleDefinitions() {
    return listAllRoleDefinitions(this.db);
  }
  // ── Project ──────────────────────────────────────────────────────
  createProject(id, kind, name, summary) {
    this.db.prepare("INSERT INTO project (id, kind, name, summary, status) VALUES (?, ?, ?, ?, 'active')").run(id, kind, name, summary ?? null);
    return this.getProject(id);
  }
  getProject(id) {
    return this.db.prepare("SELECT * FROM project WHERE id = ?").get(id);
  }
  findProjectByNameAndKind(name, kind) {
    return this.db.prepare("SELECT * FROM project WHERE name = ? AND kind = ? ORDER BY created_at ASC LIMIT 1").get(name, kind);
  }
  listProjects(limit = 50, offset = 0) {
    return this.db.prepare("SELECT * FROM project ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(limit, offset);
  }
  // ── Knowledge ────────────────────────────────────────────────────
  createKnowledge(input) {
    return this.knowledge.create(input);
  }
  getKnowledge(id) {
    return this.knowledge.get(id);
  }
  listKnowledge(filters = {}) {
    return this.knowledge.list(filters);
  }
  searchKnowledge(filters) {
    return this.knowledge.search(filters);
  }
  approveKnowledge(id, input) {
    return this.knowledge.approve(id, input);
  }
  rejectKnowledge(id, reviewer, comment) {
    return this.knowledge.reject(id, reviewer, comment);
  }
  archiveKnowledge(id, reviewer, comment) {
    return this.knowledge.archive(id, reviewer, comment);
  }
  deprecateKnowledge(id, reviewer, comment) {
    return this.knowledge.deprecate(id, reviewer, comment);
  }
  recordKnowledgeUse(input) {
    return this.knowledge.recordUse(input);
  }
  listKnowledgeUses(knowledgeId, limit = 50, offset = 0) {
    return this.knowledge.uses(knowledgeId, limit, offset);
  }
  getKnowledgeGovernance(id) {
    return this.knowledge.getGovernance(id);
  }
  listKnowledgeGovernance(limit = 50, offset = 0) {
    return this.knowledge.listGovernance(limit, offset);
  }
  updateKnowledgeGovernance(id, input) {
    return this.knowledge.updateGovernance(id, input);
  }
  createDesignDecision(input) {
    return this.designDecision.create(input);
  }
  getDesignDecision(id) {
    return this.designDecision.get(id);
  }
  listDesignDecisions(filters = {}) {
    return this.designDecision.list(filters);
  }
  searchDesignDecisions(filters) {
    return this.designDecision.search(filters);
  }
  updateDesignDecision(id, updates) {
    return this.designDecision.update(id, updates);
  }
  deprecateDesignDecision(id) {
    return this.designDecision.deprecate(id);
  }
  // ── Feature ──────────────────────────────────────────────────────
  createFeature(input) {
    this.db.prepare(
      "INSERT INTO feature (id, project_id, title, summary, status, task_anchor) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.projectId, input.title, input.summary ?? null, input.status ?? "active", input.taskAnchor ?? null);
    return this.getFeature(input.id);
  }
  getFeature(id) {
    return this.db.prepare("SELECT * FROM feature WHERE id = ?").get(id);
  }
  listFeatures(projectId) {
    return this.db.prepare("SELECT * FROM feature WHERE project_id = ? ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC").all(projectId);
  }
  updateFeature(id, updates) {
    const feature = this.getFeature(id);
    if (!feature) throw new Error(`Feature not found: ${id}`);
    this.db.prepare(
      "UPDATE feature SET title = ?, summary = ?, status = ?, task_anchor = ?, closed_at = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.title ?? feature.title,
      updates.summary ?? feature.summary,
      updates.status ?? feature.status,
      updates.task_anchor ?? feature.task_anchor,
      updates.closed_at ?? feature.closed_at,
      id
    );
    return this.getFeature(id);
  }
  // ── Stage ────────────────────────────────────────────────────────
  createStage(input) {
    this.db.prepare(
      "INSERT INTO stage (id, project_id, feature_id, stage_definition_id, type, sequence, status, output_artifacts, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.projectId, input.featureId, input.stageDefinitionId, input.type, input.sequence, input.status, JSON.stringify(input.outputArtifacts ?? {}), input.enteredAt ?? null);
    return this.getStage(input.id);
  }
  getStage(id) {
    const row = this.db.prepare("SELECT * FROM stage WHERE id = ?").get(id);
    return row ? mapStage(row) : void 0;
  }
  listStages(projectId) {
    const rows = this.db.prepare("SELECT * FROM stage WHERE project_id = ? ORDER BY sequence ASC").all(projectId);
    return rows.map(mapStage);
  }
  listStagesByFeature(featureId) {
    const rows = this.db.prepare("SELECT * FROM stage WHERE feature_id = ? ORDER BY sequence ASC").all(featureId);
    return rows.map(mapStage);
  }
  getActiveStage(featureId) {
    const row = this.db.prepare("SELECT * FROM stage WHERE feature_id = ? AND status = 'in_progress' ORDER BY sequence DESC LIMIT 1").get(featureId);
    return row ? mapStage(row) : void 0;
  }
  updateStage(id, updates) {
    const stage = this.getStage(id);
    if (!stage) throw new Error(`Stage not found: ${id}`);
    this.db.prepare(
      "UPDATE stage SET status = ?, output_artifacts = ?, entered_at = ?, left_at = ? WHERE id = ?"
    ).run(
      updates.status ?? stage.status,
      JSON.stringify(updates.output_artifacts ?? stage.output_artifacts),
      updates.entered_at ?? stage.entered_at,
      updates.left_at ?? stage.left_at,
      id
    );
    return this.getStage(id);
  }
  // ── Conversation ─────────────────────────────────────────────────
  createConversation(input) {
    this.db.prepare(
      "INSERT INTO conversation (id, project_id, feature_id, stage_id, owner_type, owner_id, title, kind, status, default_role, participating_roles, summary, from_conversation_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)"
    ).run(
      input.id,
      input.projectId,
      input.featureId,
      input.stageId,
      input.ownerType ?? "project_stage",
      input.ownerId ?? input.stageId,
      input.title,
      input.kind,
      input.defaultRole,
      JSON.stringify(input.participatingRoles),
      input.summary ?? null,
      JSON.stringify(input.fromConversationIds ?? [])
    );
    return this.getConversation(input.id);
  }
  getConversation(id) {
    const row = this.db.prepare("SELECT * FROM conversation WHERE id = ?").get(id);
    return row ? mapConversation(row) : void 0;
  }
  listConversationsByProject(projectId) {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE project_id = ? ORDER BY updated_at DESC").all(projectId);
    return rows.map(mapConversation);
  }
  listConversationsByFeature(featureId) {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE feature_id = ? ORDER BY updated_at DESC").all(featureId);
    return rows.map(mapConversation);
  }
  listConversationsByStage(stageId) {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE stage_id = ? ORDER BY updated_at DESC").all(stageId);
    return rows.map(mapConversation);
  }
  listConversationsByOwner(ownerType, ownerId) {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE owner_type = ? AND owner_id = ? ORDER BY updated_at DESC").all(ownerType, ownerId);
    return rows.map(mapConversation);
  }
  getInitialConversationByStage(stageId) {
    const row = this.db.prepare("SELECT * FROM conversation WHERE stage_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1").get(stageId);
    return row ? mapConversation(row) : void 0;
  }
  updateConversation(id, updates) {
    const conversation = this.getConversation(id);
    if (!conversation) throw new Error(`Conversation not found: ${id}`);
    this.db.prepare(
      "UPDATE conversation SET title = ?, status = ?, participating_roles = ?, summary = ?, from_conversation_ids = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.title ?? conversation.title,
      updates.status ?? conversation.status,
      JSON.stringify(updates.participating_roles ?? conversation.participating_roles),
      updates.summary ?? conversation.summary,
      JSON.stringify(updates.from_conversation_ids ?? conversation.from_conversation_ids),
      id
    );
    return this.getConversation(id);
  }
  // ── Message ──────────────────────────────────────────────────────
  addMessage(input) {
    const insert = this.db.prepare(
      "INSERT INTO message (conversation_id, client_id, from_role, to_roles, role, quoted_message_id, context_cutoff_at, runtime, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const updateConversation = this.db.prepare("UPDATE conversation SET updated_at = datetime('now') WHERE id = ?");
    const updateProject = this.db.prepare("UPDATE project SET updated_at = datetime('now') WHERE id = (SELECT project_id FROM conversation WHERE id = ? AND project_id IS NOT NULL)");
    const updateFeature = this.db.prepare("UPDATE feature SET updated_at = datetime('now') WHERE id = (SELECT feature_id FROM conversation WHERE id = ? AND feature_id IS NOT NULL)");
    const transaction = this.db.transaction((payload) => {
      insert.run(
        payload.conversationId,
        payload.clientId ?? null,
        payload.fromRole,
        JSON.stringify(payload.toRoles ?? []),
        payload.role,
        payload.quotedMessageId ?? null,
        payload.contextCutoffAt ?? "0",
        payload.runtime ?? null,
        payload.status ?? (payload.role === "assistant" ? "streaming" : "completed")
      );
      const { id: id2 } = this.db.prepare("SELECT last_insert_rowid() as id").get();
      for (const toRole of payload.toRoles ?? []) {
        this.db.prepare("INSERT INTO message_dispatch (conversation_id, message_id, to_role) VALUES (?, ?, ?)").run(payload.conversationId, id2, toRole);
      }
      updateConversation.run(payload.conversationId);
      updateProject.run(payload.conversationId);
      updateFeature.run(payload.conversationId);
      return id2;
    });
    const id = transaction(input);
    return this.getMessage(id);
  }
  addMessageEvent(messageId, event, _conversationId) {
    const message = this.getMessage(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    if (message.status !== "streaming") {
      throw new Error(`Cannot append event to terminal message ${messageId}`);
    }
    const source = defaultEventSource(event.source);
    const category = eventCategoryForKind(event.kind);
    const insert = this.db.prepare("INSERT INTO message_event (message_id, seq, category, kind, payload, source) VALUES (?, ?, ?, ?, ?, ?)");
    const nextSeqStmt = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM message_event WHERE message_id = ?");
    const transaction = this.db.transaction(() => {
      const { seq } = nextSeqStmt.get(messageId);
      if (seq === 1 && event.kind !== "start") {
        throw new Error(`first event must be start for message ${messageId}`);
      }
      if (seq !== 1 && event.kind === "start") {
        throw new Error(`start event must be the first event for message ${messageId}`);
      }
      insert.run(messageId, seq, category, event.kind, serializeMessageEventPayload(event.payload), serializeMessageEventSource(source));
      return this.db.prepare("SELECT last_insert_rowid() as id").get().id;
    });
    const id = transaction();
    return mapMessageEvent(this.db.prepare("SELECT * FROM message_event WHERE id = ?").get(id));
  }
  completeMessageWithEvent(messageId, event, status, _conversationId) {
    const insert = this.db.prepare("INSERT INTO message_event (message_id, seq, category, kind, payload, source) VALUES (?, ?, ?, ?, ?, ?)");
    const nextSeqStmt = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM message_event WHERE message_id = ?");
    const update = this.db.prepare("UPDATE message SET status = ?, updated_at = datetime('now') WHERE id = ?");
    const transaction = this.db.transaction(() => {
      const message = this.getMessage(messageId);
      if (!message) throw new Error(`Message not found: ${messageId}`);
      if (message.status !== "streaming") throw new Error(`Cannot complete terminal message ${messageId}`);
      const { seq } = nextSeqStmt.get(messageId);
      if (seq === 1) throw new Error(`Cannot complete message ${messageId} before start event`);
      insert.run(messageId, seq, eventCategoryForKind(event.kind), event.kind, serializeMessageEventPayload(event.payload), serializeMessageEventSource(defaultEventSource(event.source)));
      const id2 = this.db.prepare("SELECT last_insert_rowid() as id").get().id;
      update.run(status, messageId);
      return id2;
    });
    const id = transaction();
    return mapMessageEvent(this.db.prepare("SELECT * FROM message_event WHERE id = ?").get(id));
  }
  upsertMessageContext(messageId, kind, context, _conversationId) {
    const message = this.getMessage(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    const persisted = upsertMessageContext({ db: this.db, messageId, kind, context });
    this.reindexMessage(messageId);
    return persisted;
  }
  getMessageContext(messageId, _conversationId) {
    return getMessageContext2(this.db, messageId);
  }
  updateMessageStatus(messageId, status) {
    this.db.prepare("UPDATE message SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, messageId);
  }
  getMessageEvents(messageId, _conversationId) {
    const rows = this.db.prepare("SELECT * FROM message_event WHERE message_id = ? ORDER BY seq ASC").all(messageId);
    return rows.map(mapMessageEvent);
  }
  getMessage(messageId, conversationId) {
    const query = conversationId ? "SELECT * FROM message WHERE id = ? AND conversation_id = ?" : "SELECT * FROM message WHERE id = ?";
    const params = conversationId ? [messageId, conversationId] : [messageId];
    const row = this.db.prepare(query).get(...params);
    return row ? mapMessage(row) : null;
  }
  listStreamingAssistantMessages() {
    const rows = this.db.prepare("SELECT * FROM message WHERE role = 'assistant' AND status = 'streaming' ORDER BY datetime(created_at) ASC, id ASC").all();
    return rows.map(mapMessage);
  }
  getMessages(conversationId, limit = 100, offset = 0) {
    const rows = this.db.prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?").all(conversationId, limit, offset);
    return attachMessageEvents(rows.map(mapMessage), (messageId) => this.getMessageEvents(messageId, conversationId), (messageId) => this.getMessageContext(messageId, conversationId));
  }
  getRecentMessages(conversationId, limit = 5) {
    return getRecentMessages({ db: this.db, conversationId, limit, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) });
  }
  getLatestMessage(conversationId) {
    return getLatestMessage({ db: this.db, conversationId, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) });
  }
  getLatestRespondingRole(conversationId, participatingRoles) {
    return getLatestRespondingRole({ db: this.db, conversationId, participatingRoles });
  }
  getRecentMessagesSnapshot(conversationId, limit = 5, beforeCursorHook) {
    return getRecentMessagesSnapshot({ db: this.db, conversationId, limit, beforeCursorHook });
  }
  getLastMessageEventId(conversationId) {
    return getLastMessageEventId(this.db, conversationId);
  }
  getMessageEventsAfter(conversationId, afterEventId, untilEventId = null) {
    return getMessageEventsAfter(this.db, conversationId, afterEventId, untilEventId);
  }
  getRecentConversationMessagesWindow(conversationId, userMessageCount = 3) {
    const normalizedMessageCount = Math.max(1, userMessageCount);
    const anchorRow = this.db.prepare(`SELECT id FROM message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT 1 OFFSET ?`).get(conversationId, normalizedMessageCount - 1);
    if (!anchorRow) return this.getMessages(conversationId);
    const rows = this.db.prepare("SELECT * FROM message WHERE conversation_id = ? AND id >= ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, anchorRow.id);
    return attachMessageEvents(rows.map(mapMessage), (messageId) => this.getMessageEvents(messageId, conversationId), (messageId) => this.getMessageContext(messageId, conversationId));
  }
  getMessagesSinceRoleReply(conversationId, roleName) {
    return getMessagesSinceRoleReply({ db: this.db, conversationId, roleName, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) });
  }
  getDispatchInboxMessages(conversationId, roleName, dispatchSourceMessageIds) {
    return getDispatchInboxMessages({ db: this.db, conversationId, roleName, dispatchSourceMessageIds, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) });
  }
  getMessagesByIds(conversationId, messageIds) {
    return getMessagesByIds({ db: this.db, conversationId, messageIds, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) });
  }
  getMessageWindow(conversationId, anchorMessageId, before = 2, after = 2) {
    return getMessageWindow({ db: this.db, conversationId, anchorMessageId, before, after, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) });
  }
  searchConversationMessages(conversationId, query, limit = 5, offset = 0) {
    return searchConversationMessages({ db: this.db, conversationId, query, limit, offset });
  }
  // ── Message Dispatch ─────────────────────────────────────────────
  addMessageDispatch(input) {
    this.db.prepare("INSERT INTO message_dispatch (conversation_id, message_id, to_role) VALUES (?, ?, ?)").run(input.conversationId, input.messageId, input.toRole);
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get();
    return this.db.prepare("SELECT * FROM message_dispatch WHERE id = ?").get(id);
  }
  rebuildDispatchesForMessage(messageId, _conversationId) {
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("DELETE FROM message_dispatch WHERE message_id = ?").run(messageId);
    for (const toRole of message.to_roles) {
      this.addMessageDispatch({ conversationId: message.conversation_id, messageId: message.id, toRole });
    }
  }
  updateMessageRouting(messageId, toRoles, _conversationId) {
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("UPDATE message SET to_roles = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(toRoles), messageId);
    this.rebuildDispatchesForMessage(messageId, _conversationId);
  }
  listPendingDispatches(conversationId, toRole) {
    if (toRole) {
      return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_role = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, toRole);
    }
    return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId);
  }
  listDispatches(conversationId) {
    return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId);
  }
  listDispatchInboxGroups(conversationId) {
    const rows = this.db.prepare(`SELECT to_role, status, GROUP_CONCAT(id) as dispatch_ids, GROUP_CONCAT(message_id) as message_ids, MAX(created_at) as latest_dispatch_at FROM message_dispatch WHERE conversation_id = ? GROUP BY to_role, status ORDER BY datetime(latest_dispatch_at) ASC, to_role ASC`).all(conversationId);
    return rows.map((row) => ({ to_role: row.to_role, status: row.status, dispatch_ids: row.dispatch_ids.split(",").map(Number).filter(Number.isInteger), message_ids: row.message_ids.split(",").map(Number).filter(Number.isInteger), latest_dispatch_at: row.latest_dispatch_at }));
  }
  markDispatchesConsumed(dispatchIds, consumedByMessageId = null) {
    markProjectDispatchesConsumed(this.db, dispatchIds, consumedByMessageId);
  }
  markConversationDispatchesConsumed(conversationId, dispatchIds, consumedByMessageId = null) {
    this.markDispatchesConsumed(dispatchIds, consumedByMessageId);
  }
  markDispatchesSeen(dispatchIds) {
    markProjectDispatchesSeen(this.db, dispatchIds);
  }
  markConversationDispatchesSeen(conversationId, dispatchIds) {
    this.markDispatchesSeen(dispatchIds);
  }
  skipDispatches(dispatchIds) {
    skipProjectDispatches(this.db, dispatchIds);
  }
  skipConversationDispatches(conversationId, dispatchIds) {
    this.skipDispatches(dispatchIds);
  }
  listBossPendingDispatches(conversationId) {
    return listProjectBossPendingDispatches(this.db, conversationId);
  }
  // ── Snail Agent Session ──────────────────────────────────────────
  createSnailAgentSession(input) {
    if (input.contextProvider === "agent" && input.runtime === "claude-code-cli") {
      throw new Error(`contextProvider "agent" requires a stateful runtime, but "claude-code-cli" is stateless (role "${input.roleName}")`);
    }
    this.db.prepare(
      "INSERT INTO snail_agent_session (id, conversation_id, role_name, runtime, model, context_provider, external_session_id, handoff_from_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.conversationId, input.roleName, input.runtime, input.model, input.contextProvider, input.externalSessionId ?? null, input.handoffFromId ?? null);
    return this.getCurrentSnailAgentSession(input.conversationId, input.roleName);
  }
  getCurrentSnailAgentSession(conversationId, roleName) {
    const row = this.db.prepare(
      "SELECT * FROM snail_agent_session WHERE conversation_id = ? AND role_name = ? ORDER BY created_at DESC LIMIT 1"
    ).get(conversationId, roleName);
    if (!row) return null;
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      role_name: row.role_name,
      runtime: row.runtime,
      model: row.model,
      context_provider: row.context_provider,
      external_session_id: row.external_session_id,
      handoff_from_id: row.handoff_from_id,
      created_at: row.created_at
    };
  }
  updateSnailAgentSessionExternalId(sessionId, externalSessionId) {
    this.db.prepare("UPDATE snail_agent_session SET external_session_id = ? WHERE id = ?").run(externalSessionId, sessionId);
  }
  // ── Search ───────────────────────────────────────────────────────
  rebuildSearchIndex(conversationId) {
    const targetMessages = conversationId ? this.db.prepare("SELECT id FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) : this.db.prepare("SELECT id FROM message ORDER BY datetime(created_at) ASC, id ASC").all();
    if (conversationId) this.db.prepare("DELETE FROM message_search WHERE conversation_id = ?").run(conversationId);
    else this.db.prepare("DELETE FROM message_search").run();
    targetMessages.forEach((message) => this.reindexMessage(message.id));
    return { indexed_messages: targetMessages.length };
  }
  reindexMessage(messageId) {
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("DELETE FROM message_search WHERE message_id = ?").run(String(messageId));
    const content = buildSearchableMessageContent(message.role, this.getMessageContext(messageId), this.getMessageEvents(messageId));
    if (!content) return;
    this.db.prepare("INSERT INTO message_search (conversation_id, message_id, role, from_role, content) VALUES (?, ?, ?, ?, ?)").run(message.conversation_id, String(message.id), message.role, message.from_role, content);
  }
  close() {
    this.db.close();
  }
};

// src/bin/knowledge-candidate.ts
var SCOPE_TYPES = /* @__PURE__ */ new Set(["global", "project", "feature", "stage_type", "conversation", "snail", "code_area", "workflow"]);
var KINDS = /* @__PURE__ */ new Set(["decision", "rule", "preference", "incident", "anti_pattern", "glossary", "open_question", "procedure", "fact", "pattern"]);
var SOURCE_TYPES = /* @__PURE__ */ new Set(["message", "artifact", "conversation", "stage", "feature", "project", "pull_request", "review_comment", "test_failure", "external"]);
function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = parseCandidateInput(readInput(args.inputPath));
  const store = new ConversationStore(args.dbPath);
  try {
    store.seedProjectConfig({ project: { id: "knowledge-center", kind: "system_self", module: "knowledge_governance", name: "Knowledge Center", summary: "\u77E5\u8BC6\u4E2D\u5FC3\u5185\u7F6E\u9879\u76EE" }, stage_definitions: [{ id: "knowledge-center-development", key: "development", title: "\u7814\u53D1\u8FED\u4EE3", sequence: 1, input_description: null, output_description: "\u5B8C\u6210\u5019\u9009\u77E5\u8BC6\u6CBB\u7406", acceptance_focus: [], roles: [{ id: "kc-sr-boss", name: "Boss Role", snail_template_id: "opencode-default", is_primary: true, description: "最终决策者，确认治理结论", working_rules: ["以数据为依据做决策", "治理结论需明确落地入口"] }, { id: "kc-sr-executor", name: "\u77E5\u8BC6\u6267\u884C\u8005", snail_template_id: "opencode-default", is_primary: false, description: "负责执行知识治理流程：入口校验、查重、裁决去向跟踪", working_rules: ["严格按入口校验流程", "查重需覆盖全局知识库", "裁决去向必须明确并记录PR链接"] }] }] });
    const candidate = store.createKnowledge(toCreateKnowledgeInput(input));
    process.stdout.write(`${JSON.stringify({ ok: true, knowledge_id: candidate.id, status: candidate.status, governance_id: candidate.governance?.id ?? null, governance_conversation_id: candidate.governance?.conversation?.id ?? null }, null, 2)}
`);
  } finally {
    store.close();
  }
}
function parseArgs(argv) {
  const getValue = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 && index < argv.length - 1 ? argv[index + 1] ?? "" : "";
  };
  return {
    dbPath: getValue("--db-path") || process.env.DB_PATH || import_path2.default.join(process.cwd(), "data", "snail-shell.db"),
    inputPath: getValue("--input") || null
  };
}
function readInput(inputPath) {
  const raw = inputPath ? import_fs.default.readFileSync(inputPath, "utf8") : import_fs.default.readFileSync(0, "utf8");
  if (!raw.trim()) throw new Error("knowledge candidate input is required");
  return raw;
}
function parseCandidateInput(raw) {
  const parsed = JSON.parse(raw);
  const validation = validateCandidateInput(parsed);
  if (validation) throw new Error(validation);
  return parsed;
}
function validateCandidateInput(input) {
  if (!stringValue(input.title)) return "title is required";
  if (!stringValue(input.content)) return "content is required";
  if (!enumValue(input.scope_type, SCOPE_TYPES)) return "scope_type is invalid";
  if (!enumValue(input.kind, KINDS)) return "kind is invalid";
  if (input.sources !== void 0 && !Array.isArray(input.sources)) return "sources must be an array";
  const invalidSource = input.sources?.find((source) => source.source_type !== void 0 && !enumValue(source.source_type, SOURCE_TYPES));
  if (invalidSource) return "source_type is invalid";
  return null;
}
function toCreateKnowledgeInput(input) {
  return {
    id: (0, import_crypto.randomUUID)(),
    projectId: input.project_id ?? null,
    scopeType: input.scope_type,
    scopeRef: input.scope_ref ?? null,
    kind: input.kind,
    status: "candidate",
    governanceLevel: "L0",
    title: input.title.trim(),
    content: input.content.trim(),
    rationale: input.rationale?.trim() || null,
    createdBy: input.created_by?.trim() || "knowledge-candidate-script",
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    sources: (input.sources ?? []).map((source) => ({
      id: (0, import_crypto.randomUUID)(),
      sourceType: source.source_type ?? "external",
      sourceId: source.source_id || "manual",
      quote: source.quote ?? null
    }))
  };
}
function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function enumValue(value, allowed) {
  return typeof value === "string" && allowed.has(value) ? value : null;
}
main();
