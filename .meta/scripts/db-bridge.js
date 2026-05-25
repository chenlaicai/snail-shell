#!/usr/bin/env node
"use strict";

// db-bridge — 共享数据访问层。对 AI 不可见。
// 所有 skill 通过此桥接访问数据库，不直接传 --db-path。
// DB 路径仅通过 DB_PATH 环境变量或默认路径解析。

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return path.join(process.cwd(), "data", "snail-shell.db");
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
  };
}

function parseNullable(value) { if (!value || value === "null") return null; return value; }
function toPositiveInt(value, fallback) { if (!value) return fallback; const n = Number(value); return Number.isInteger(n) && n > 0 ? n : fallback; }
function fail(message) { process.stderr.write(message + "\n"); process.exit(1); }

// Run as CLI when executed directly; also usable as require() module
if (require.main === module) {
  main();
}

module.exports = { knowledgeLibrary, conversationHistory, resolveDbPath };
