#!/usr/bin/env node
"use strict";

// db-bridge — 共享数据访问层。对 AI 不可见。
// 所有 skill 通过此桥接访问数据库，不直接传 --db-path。
// DB 路径仅通过 DB_PATH 环境变量或默认路径解析。

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const repoRoot = findRepoRoot(process.cwd());
  return path.join(repoRoot, "data", "snail-shell.db");
}

function findRepoRoot(startDir) {
  // Walk up to find .git
  let dir = path.resolve(startDir);
  while (true) {
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) return dir;
      // .git is a file → worktree, parse gitdir to find shared repo
      const gitFile = fs.readFileSync(gitPath, "utf8").trim();
      const m = /^gitdir:\s*(.+)$/i.exec(gitFile);
      if (m) {
        const gitDir = path.resolve(dir, m[1]);
        const commonDirFile = path.join(gitDir, "commondir");
        if (fs.existsSync(commonDirFile)) {
          const commonGitDir = path.resolve(gitDir, fs.readFileSync(commonDirFile, "utf8").trim());
          if (path.basename(commonGitDir) === ".git") return path.dirname(commonGitDir);
        }
      }
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function openDb() {
  return new Database(resolveDbPath());
}

// ── FTS helpers ──────────────────────────────────────────
function buildFtsQuery(query) {
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return "*";
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}

function normalizeSnippet(snippet) {
  return snippet.replace(/\s+/g, " ").trim();
}

// ── Knowledge Library ────────────────────────────────────
const knowledgeLibrary = {
  summary(projectId) {
    const db = openDb();
    try {
      const where = projectId ? "WHERE project_id = ? AND status = 'active'" : "WHERE status = 'active'";
      const params = projectId ? [projectId] : [];
      const rows = db.prepare(`SELECT kind, COUNT(*) as count FROM knowledge_library ${where} GROUP BY kind ORDER BY kind ASC`).all(...params);
      return rows;
    } finally {
      db.close();
    }
  },

  list(filters) {
    const db = openDb();
    try {
      if (filters.query && filters.query.trim()) return knowledgeLibrary.search(filters, db);
      const { where, params } = buildWhere(filters);
      const rows = db.prepare(
        `SELECT * FROM knowledge_library ${where} ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT ? OFFSET ?`
      ).all(...params, filters.limit ?? 50, filters.offset ?? 0);
      return rows.map(toSearchResult);
    } finally {
      db.close();
    }
  },

  get(id) {
    const db = openDb();
    try {
      return db.prepare("SELECT * FROM knowledge_library WHERE id = ?").get(id) ?? null;
    } finally {
      db.close();
    }
  },

  search(filters, existingDb) {
    const db = existingDb || openDb();
    const shouldClose = !existingDb;
    try {
      const built = buildWhere(filters, "kl.");
      const where = ["knowledge_library_search MATCH ?", ...built.clauses].join(" AND ");
      const rows = db.prepare(
        `SELECT kl.*, snippet(knowledge_library_search, 5, '[', ']', '...', 24) AS snippet
         FROM knowledge_library_search
         JOIN knowledge_library kl ON kl.id = knowledge_library_search.entry_id
         WHERE ${where}
         ORDER BY rank, datetime(kl.updated_at) DESC
         LIMIT ? OFFSET ?`
      ).all(buildFtsQuery(filters.query ?? ""), ...built.params, filters.limit ?? 50, filters.offset ?? 0);
      return rows.map((row) => ({ ...toSearchResult(row), snippet: normalizeSnippet(row.snippet) }));
    } finally {
      if (shouldClose) db.close();
    }
  },

  create(params) {
    const db = openDb();
    try {
      const id = crypto.randomUUID();
      const status = params.status ?? "active";
      db.prepare(
        `INSERT INTO knowledge_library (id, project_id, kind, title, summary, use_scenarios, non_use_scenarios, content, status, source_knowledge_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, params.projectId ?? null, params.kind, params.title, params.summary ?? "", params.useScenarios ?? "", params.nonUseScenarios ?? "", params.content, status, params.sourceKnowledgeId ?? null);
      reindexKnowledgeLibrary(db, id);
      return { ok: true, entry_id: id };
    } finally {
      db.close();
    }
  },

  deprecate(id) {
    const db = openDb();
    try {
      db.prepare("UPDATE knowledge_library SET status = 'deprecated', updated_at = datetime('now') WHERE id = ?").run(id);
      return { ok: true, entry_id: id };
    } finally {
      db.close();
    }
  },
};

function reindexKnowledgeLibrary(db, entryId) {
  const item = db.prepare("SELECT * FROM knowledge_library WHERE id = ?").get(entryId);
  db.prepare("DELETE FROM knowledge_library_search WHERE entry_id = ?").run(entryId);
  if (!item) return;
  db.prepare(
    "INSERT INTO knowledge_library_search (entry_id, project_id, kind, status, title, summary, content) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(item.id, item.project_id, item.kind, item.status, item.title, item.summary, item.content);
}

function toSearchResult(item) {
  return {
    id: item.id,
    project_id: item.project_id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    use_scenarios: item.use_scenarios,
    non_use_scenarios: item.non_use_scenarios,
    content: item.content,
    snippet: item.summary || item.content.slice(0, 240),
    status: item.status,
    source_knowledge_id: item.source_knowledge_id,
    updated_at: item.updated_at,
  };
}

function buildWhere(filters, prefix) {
  prefix = prefix || "";
  const clauses = [];
  const params = [];
  if (filters.projectId !== undefined) {
    if (filters.projectId === null) {
      clauses.push(`${prefix}project_id IS NULL`);
    } else {
      clauses.push(`${prefix}project_id = ?`);
      params.push(filters.projectId);
    }
  }
  if (filters.kind) { clauses.push(`${prefix}kind = ?`); params.push(filters.kind); }
  if (filters.status) { clauses.push(`${prefix}status = ?`); params.push(filters.status); }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", clauses, params };
}

// ── Conversation History ─────────────────────────────────
const conversationHistory = {
  search(params) {
    const db = openDb();
    try {
      const { searchClause, searchParams } = buildSearchWhere(params);
      const rows = db.prepare(
        `SELECT * FROM message_search ${searchClause} ORDER BY rank LIMIT ?`
      ).all(...searchParams, params.limit ?? 5);
      return rows.map(toMessageResult);
    } finally {
      db.close();
    }
  },

  window(params) {
    const db = openDb();
    try {
      const msg = db.prepare("SELECT id, created_at, conversation_id FROM message WHERE id = ? AND conversation_id = ?").get(params.anchorMessageId, params.conversationId);
      if (!msg) return [];
      const order = params.direction === "forward" ? "ASC" : "DESC";
      const compare = params.direction === "forward" ? ">" : "<";
      const before = params.before ?? 2;
      const after = params.after ?? 2;
      const beforeRows = db.prepare(
        `SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) ${compare} datetime(?) ORDER BY datetime(created_at) ${order}, id ${order} LIMIT ?`
      ).all(params.conversationId, msg.created_at, before);
      const afterRows = db.prepare(
        `SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) >= datetime(?) AND id != ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ?`
      ).all(params.conversationId, msg.created_at, params.anchorMessageId, after + 1);
      return [...beforeRows.reverse(), ...afterRows].map(toMessageRow);
    } finally {
      db.close();
    }
  },

  byIds(params) {
    const db = openDb();
    try {
      const ids = params.messageIds;
      if (!ids || ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      return db.prepare(
        `SELECT * FROM message WHERE id IN (${placeholders}) AND conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC`
      ).all(...ids, params.conversationId).map(toMessageRow);
    } finally {
      db.close();
    }
  },

  recent(params) {
    const db = openDb();
    try {
      const userMessages = db.prepare(
        `SELECT id FROM message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`
      ).all(params.conversationId, params.limit ?? 10);
      if (userMessages.length === 0) return [];
      const ids = userMessages.map((m) => m.id);
      const result = [];
      const seen = new Set();
      for (const id of ids.reverse()) {
        const window = db.prepare(
          `SELECT id FROM message WHERE conversation_id = ? AND datetime(created_at) >= datetime((SELECT created_at FROM message WHERE id = ?)) ORDER BY datetime(created_at) ASC, id ASC`
        ).all(params.conversationId, id);
        for (const row of window) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            result.push(row.id);
          }
        }
      }
      if (result.length === 0) return [];
      const placeholders = result.map(() => "?").join(",");
      return db.prepare(
        `SELECT * FROM message WHERE id IN (${placeholders}) ORDER BY datetime(created_at) ASC, id ASC`
      ).all(...result).map(toMessageRow);
    } finally {
      db.close();
    }
  },

  page(params) {
    const db = openDb();
    try {
      return db.prepare(
        `SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?`
      ).all(params.conversationId, params.limit ?? 50, params.offset ?? 0).map(toMessageRow);
    } finally {
      db.close();
    }
  },

  reindex(params) {
    const db = openDb();
    try {
      const targetMessages = params.conversationId
        ? db.prepare("SELECT id FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(params.conversationId)
        : db.prepare("SELECT id FROM message ORDER BY datetime(created_at) ASC, id ASC").all();
      if (params.conversationId) db.prepare("DELETE FROM message_search WHERE conversation_id = ?").run(params.conversationId);
      else db.prepare("DELETE FROM message_search").run();
      for (const msg of targetMessages) {
        const row = db.prepare("SELECT * FROM message WHERE id = ?").get(msg.id);
        if (!row) continue;
        const events = db.prepare("SELECT * FROM message_event WHERE message_id = ? ORDER BY seq ASC").all(row.id);
        const content = buildSearchableContent(row.role, events);
        if (!content) continue;
        db.prepare("DELETE FROM message_search WHERE message_id = ?").run(String(row.id));
        db.prepare("INSERT INTO message_search (conversation_id, message_id, role, from_role, content) VALUES (?, ?, ?, ?, ?)").run(row.conversation_id, String(row.id), row.role, row.from_role, content);
      }
      return { indexed_messages: targetMessages.length };
    } finally {
      db.close();
    }
  },
};

function buildSearchWhere(params) {
  const clauses = [];
  const searchParams = [];
  clauses.push("message_search MATCH ?");
  searchParams.push(buildFtsQuery(params.query ?? ""));
  if (params.conversationId) {
    clauses.push("conversation_id = ?");
    searchParams.push(params.conversationId);
  }
  return { searchClause: `WHERE ${clauses.join(" AND ")}`, searchParams };
}

function toMessageResult(row) {
  return {
    message_id: row.message_id,
    conversation_id: row.conversation_id,
    role: row.role,
    from_role: row.from_role,
    snippet: normalizeSnippet(row.snippet || ""),
  };
}

function toMessageRow(row) {
  try { row.events = JSON.parse(row.events || "[]"); } catch (_) { row.events = []; }
  try { row.metadata = JSON.parse(row.metadata || "{}"); } catch (_) { row.metadata = {}; }
  return row;
}

function buildSearchableContent(role, events) {
  const parts = [role];
  for (const event of events) {
    let payload = event.payload;
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (_) { payload = {}; } }
    if (event.kind === "text") parts.push(payload?.text ?? "");
    else if (event.kind === "tool_call") parts.push(payload?.tool_name ?? "");
    else if (event.kind === "tool_result") parts.push(payload?.output_text ?? "");
    else if (event.kind === "command") parts.push(payload?.command ?? "");
    else if (event.kind === "command_result") parts.push(payload?.output_text ?? "");
    else if (event.kind === "error") parts.push(payload?.message ?? "");
    else if (event.kind === "content_block") parts.push(payload?.fallback_text ?? "");
  }
  const content = parts.filter(Boolean).join(" ").trim();
  return content || null;
}

// ── Knowledge Candidate ──────────────────────────────────
const knowledgeCandidate = {
  create(input) {
    const db = openDb();
    const id = crypto.randomUUID();
    try {
      const status = "candidate";
      const governanceLevel = "L0";
      const tx = db.transaction(() => {
        db.prepare(
          "INSERT INTO knowledge_item (id, project_id, scope_type, scope_ref, kind, status, governance_level, title, content, rationale, created_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(id, input.projectId ?? null, input.scopeType, input.scopeRef ?? null, input.kind, status, governanceLevel, input.title, input.content, input.rationale ?? null, input.createdBy ?? null, input.metadata ?? null);
        for (const source of input.sources ?? []) {
          db.prepare(
            "INSERT INTO knowledge_source (id, knowledge_id, source_type, source_id, quote) VALUES (?, ?, ?, ?, ?)"
          ).run(source.id || crypto.randomUUID(), id, source.sourceType, source.sourceId, source.quote ?? null);
        }
        const governanceId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO knowledge_governance (id, knowledge_id, entry_check_status, dedupe_status, scenario_type, disposition_status, artifact_type, related_knowledge_ids, runtime_feedback_allowed, runtime_feedback_channels)
           VALUES (?, ?, 'pending_entry_check', 'pending', 'pending', 'pending', 'pending', '[]', 0, '[]')`
        ).run(governanceId, id);
        // 创建 Feature + Stage，治理对话提示词构建依赖它们
        const featureId = crypto.randomUUID();
        db.prepare(
          "INSERT INTO feature (id, project_id, title, summary, task_anchor, role_snail_mapping) VALUES (?, 'knowledge-center', ?, NULL, NULL, '{}')"
        ).run(featureId, input.title);
        const stageId = crypto.randomUUID();
        db.prepare(
          "INSERT INTO stage (id, project_id, feature_id, stage_definition_id, type, sequence, status, output_artifacts, entered_at) VALUES (?, 'knowledge-center', ?, 'knowledge-center-development', 'development', 1, 'in_progress', '{}', datetime('now'))"
        ).run(stageId, featureId);
        const convId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO conversation (id, project_id, feature_id, stage_id, kind, title, owner_type, owner_id, summary, status, default_role, participating_roles, from_conversation_ids)
           VALUES (?, 'knowledge-center', ?, ?, 'discussion', ?, 'knowledge_governance', ?, '治理对话', 'active', 'Boss Role', '["Boss Role","知识执行者"]', '[]')`
        ).run(convId, featureId, stageId, input.title, governanceId);
        reindexKnowledgeItem(db, id);
      });
      tx();
      const item = db.prepare("SELECT * FROM knowledge_item WHERE id = ?").get(id);
      const governance = db.prepare("SELECT * FROM knowledge_governance WHERE knowledge_id = ?").get(id);
      const conversation = db.prepare("SELECT id FROM conversation WHERE owner_type = 'knowledge_governance' AND owner_id = ?").get(governance?.id);
      return {
        ok: true,
        knowledge_id: id,
        status: item.status,
        governance_id: governance?.id ?? null,
        governance_conversation_id: conversation?.id ?? null,
      };
    } finally {
      db.close();
    }
  },
};

function reindexKnowledgeItem(db, knowledgeId) {
  const item = db.prepare("SELECT * FROM knowledge_item WHERE id = ?").get(knowledgeId);
  if (!item) return;
  db.prepare("DELETE FROM knowledge_search WHERE knowledge_id = ?").run(knowledgeId);
  db.prepare(
    "INSERT INTO knowledge_search (knowledge_id, kind, status, title, content) VALUES (?, ?, ?, ?, ?)"
  ).run(item.id, item.kind, item.status, item.title, item.content);
}

// ── CLI entry (internal use by skill scripts) ────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  switch (args.mode) {
    case "knowledge-summary":
      result = { mode: "summary", categories: knowledgeLibrary.summary(args.projectId) };
      break;
    case "knowledge-list":
      if (!args.kind) fail("--kind is required");
      result = { mode: "list", kind: args.kind, items: knowledgeLibrary.list({ projectId: args.projectId, kind: args.kind, status: args.status, query: args.query, limit: args.limit, offset: args.offset }) };
      break;
    case "knowledge-get":
      if (!args.id) fail("--id is required");
      result = { mode: "get", entry: knowledgeLibrary.get(args.id) };
      break;
    case "knowledge-search":
      if (!args.query) fail("--query is required");
      result = { mode: "search", query: args.query, items: knowledgeLibrary.search({ projectId: args.projectId, kind: args.kind, status: args.status, query: args.query, limit: args.limit, offset: args.offset }) };
      break;
    case "knowledge-create":
      if (!args.kind || !args.title || !args.content || !args.summary || args.useScenarios === undefined || args.nonUseScenarios === undefined) fail("--kind, --title, --content, --summary, --use-scenarios, --non-use-scenarios are required");
      result = knowledgeLibrary.create({ projectId: args.projectId, kind: args.kind, title: args.title, summary: args.summary, useScenarios: args.useScenarios, nonUseScenarios: args.nonUseScenarios, content: args.content, sourceKnowledgeId: args.sourceKnowledgeId });
      break;
    case "knowledge-deprecate":
      if (!args.id) fail("--id is required");
      result = knowledgeLibrary.deprecate(args.id);
      break;
    case "history-search":
      result = { mode: "search", query: args.query, messages: conversationHistory.search({ conversationId: args.conversationId, query: args.query, limit: args.limit }) };
      break;
    case "history-window":
      if (!args.anchorMessageId) fail("--anchor-message-id is required");
      result = { mode: "window", messages: conversationHistory.window({ conversationId: args.conversationId, anchorMessageId: args.anchorMessageId, before: args.before, after: args.after, direction: args.direction }) };
      break;
    case "history-by-ids":
      if (!args.messageIds) fail("--message-ids is required");
      result = { mode: "by-ids", messages: conversationHistory.byIds({ conversationId: args.conversationId, messageIds: args.messageIds.split(",").map((s) => s.trim()).filter(Boolean) }) };
      break;
    case "history-recent":
      result = { mode: "recent", messages: conversationHistory.recent({ conversationId: args.conversationId, limit: args.limit }) };
      break;
    case "history-page":
      result = { mode: "page", messages: conversationHistory.page({ conversationId: args.conversationId, limit: args.limit, offset: args.offset }) };
      break;
    case "history-reindex":
      result = { mode: "reindex", conversation_id: args.conversationId || null, ...conversationHistory.reindex({ conversationId: args.conversationId }) };
      break;
    case "candidate-create":
      result = knowledgeCandidate.create({
        projectId: args.projectId,
        scopeType: args.scopeType || "project",
        scopeRef: args.scopeRef ?? null,
        kind: args.kind || "constraint",
        title: args.title || "",
        content: args.content || "",
        rationale: args.rationale ?? null,
        createdBy: args.createdBy ?? null,
        metadata: args.metadata ?? null,
        sources: args.sources ?? [],
      });
      break;
    case "feature-set-task-anchor": {
      if (!args.featureId) fail("--feature-id is required");
      if (!args.taskAnchor) fail("--task-anchor is required");
      const db = openDb();
      try {
        const feature = db.prepare("SELECT * FROM feature WHERE id = ?").get(args.featureId);
        if (!feature) fail(`Feature not found: ${args.featureId}`);
        if (feature.closed_at) fail("Archived feature is read-only");
        db.prepare("UPDATE feature SET task_anchor = ?, updated_at = datetime('now') WHERE id = ?").run(args.taskAnchor, args.featureId);
        const updated = db.prepare("SELECT * FROM feature WHERE id = ?").get(args.featureId);
        result = { feature_id: updated.id, task_anchor: updated.task_anchor };
      } finally { db.close(); }
      break;
    }
    case "stage-record-context": {
      if (!args.stageId) fail("--stage-id is required");
      if (!args.entries) fail("--entries is required (JSON object)");
      const db = openDb();
      try {
        const stage = db.prepare("SELECT * FROM stage WHERE id = ?").get(args.stageId);
        if (!stage) fail(`Stage not found: ${args.stageId}`);
        const feature = db.prepare("SELECT * FROM feature WHERE id = ?").get(stage.feature_id);
        if (!feature) fail(`Feature not found: ${stage.feature_id}`);
        if (feature.closed_at) fail("Archived feature is read-only");
        let current = {};
        try { current = JSON.parse(stage.output_artifacts || "{}"); } catch (_) {}
        const entries = JSON.parse(args.entries);
        const updated = { ...current, ...entries };
        db.prepare("UPDATE stage SET output_artifacts = ? WHERE id = ?").run(JSON.stringify(updated), args.stageId);
        result = { stage_id: stage.id, feature_id: stage.feature_id, feature_title: feature.title, stage_type: stage.type, output_artifacts: updated };
      } finally { db.close(); }
      break;
    }
    case "context-query": {
      if (!args.conversationId) fail("--conversation-id is required");
      const db = openDb();
      try {
        const conv = db.prepare("SELECT * FROM conversation WHERE id = ?").get(args.conversationId);
        if (!conv) fail(`Conversation not found: ${args.conversationId}`);
        let stage = null, stageDef = null, stageRoles = [], inputArtifacts = {};
        if (conv.stage_id) {
          stage = db.prepare("SELECT * FROM stage WHERE id = ?").get(conv.stage_id);
          if (stage) {
            stageDef = db.prepare("SELECT * FROM project_stage_definition WHERE id = ?").get(stage.stage_definition_id);
            stageRoles = db.prepare("SELECT * FROM stage_role_definition WHERE stage_definition_id = ?").all(stage.stage_definition_id);
            if (stage.sequence > 1) {
              const prevStage = db.prepare("SELECT * FROM stage WHERE feature_id = ? AND sequence = ?").get(stage.feature_id, stage.sequence - 1);
              if (prevStage) { try { inputArtifacts = JSON.parse(prevStage.output_artifacts || "{}"); } catch (_) {} }
            }
          }
        }
        let feature = null;
        if (conv.feature_id) feature = db.prepare("SELECT * FROM feature WHERE id = ?").get(conv.feature_id);
        let project = null;
        if (conv.project_id) project = db.prepare("SELECT * FROM project WHERE id = ?").get(conv.project_id);
        // Parse JSON fields for message-out
        try { conv.participating_roles = JSON.parse(conv.participating_roles || "[]"); } catch (_) { conv.participating_roles = []; }
        try { conv.from_conversation_ids = JSON.parse(conv.from_conversation_ids || "[]"); } catch (_) { conv.from_conversation_ids = []; }
        if (stageDef) { try { stageDef.acceptance_focus = JSON.parse(stageDef.acceptance_focus || "[]"); } catch (_) { stageDef.acceptance_focus = []; } }
        stageRoles.forEach((r) => { try { r.working_rules = JSON.parse(r.working_rules || "[]"); } catch (_) { r.working_rules = []; } });
        try { stage.output_artifacts = JSON.parse(stage?.output_artifacts || "{}"); } catch (_) { stage.output_artifacts = {}; }
        result = { conv, stage, stageDef, stageRoles, feature, project, inputArtifacts };
      } finally { db.close(); }
      break;
    }
    case "stage-get-active": {
      if (!args.featureId) fail("--feature-id is required");
      const db = openDb();
      try {
        const stage = db.prepare(
          "SELECT * FROM stage WHERE feature_id = ? AND status = 'in_progress' ORDER BY sequence DESC LIMIT 1"
        ).get(args.featureId);
        result = stage ? { stage } : { stage: null };
      } finally { db.close(); }
      break;
    }
    case "stage-list-for-workdir": {
      // 返回所有 stage 的 worktree_path 映射，供 wrapper 做 auto-discovery
      const db = openDb();
      try {
        const rows = db.prepare("SELECT id, output_artifacts FROM stage WHERE output_artifacts IS NOT NULL AND output_artifacts != ''").all();
        const stages = rows.map((r) => {
          let artifacts = {};
          try { artifacts = JSON.parse(r.output_artifacts || "{}"); } catch (_) {}
          return { id: r.id, worktree_path: artifacts.worktree_path || null };
        }).filter((s) => s.worktree_path);
        result = { stages };
      } finally { db.close(); }
      break;
    }
    default:
      fail(`Unsupported mode: ${args.mode}`);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function parseArgs(argv) {
  const getValue = (name) => { const i = argv.indexOf(name); return (i === -1 || i === argv.length - 1) ? "" : (argv[i + 1] ?? ""); };
  const optStr = (name) => getValue(name) || undefined;
  const hasArg = (name) => argv.includes(name);
  const mode = getValue("--mode");
  if (!mode) fail("--mode is required");
  return {
    mode,
    kind: optStr("--kind"),
    status: optStr("--status"),
    projectId: hasArg("--project-id") ? parseNullable(getValue("--project-id")) : undefined,
    id: optStr("--id"),
    title: optStr("--title"),
    summary: optStr("--summary"),
    useScenarios: optStr("--use-scenarios"),
    nonUseScenarios: optStr("--non-use-scenarios"),
    content: optStr("--content"),
    sourceKnowledgeId: optStr("--source-knowledge-id"),
    query: optStr("--query"),
    conversationId: optStr("--conversation-id"),
    anchorMessageId: optStr("--anchor-message-id"),
    messageIds: optStr("--message-ids"),
    before: toPositiveInt(getValue("--before"), 2),
    after: toPositiveInt(getValue("--after"), 2),
    direction: optStr("--direction"),
    limit: toPositiveInt(getValue("--limit"), 50),
    offset: toPositiveInt(getValue("--offset"), 0),
    scopeType: optStr("--scope-type"),
    scopeRef: optStr("--scope-ref"),
    createdBy: optStr("--created-by"),
    metadata: optStr("--metadata"),
    sources: optStr("--sources") ? JSON.parse(optStr("--sources")) : undefined,
    featureId: optStr("--feature-id"),
    taskAnchor: optStr("--task-anchor"),
    stageId: optStr("--stage-id"),
    entries: optStr("--entries"),
    contextName: optStr("--context-name"),
  };
}

function parseNullable(value) { if (!value || value === "null") return null; return value; }
function toPositiveInt(value, fallback) { if (!value) return fallback; const n = Number(value); return Number.isInteger(n) && n > 0 ? n : fallback; }
function fail(message) { process.stderr.write(message + "\n"); process.exit(1); }

// Run as CLI when executed directly; also usable as require() module
if (require.main === module) {
  main();
}

module.exports = { knowledgeLibrary, conversationHistory, knowledgeCandidate, resolveDbPath };
