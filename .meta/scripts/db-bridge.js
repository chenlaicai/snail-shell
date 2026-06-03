#!/usr/bin/env node
"use strict";

// db-bridge — 共享数据访问层。对 AI 不可见。
// 所有 skill 通过此桥接访问数据库，不直接传 --db-path。
// DB 路径仅通过 DB_PATH 环境变量或默认路径解析。

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

/**
 * 创建 FileConfigStore 实例。每次调用都创建新实例，不使用单例缓存。
 *
 * Why: 单例缓存会锁定首次调用时的 repo root；如果脚本从不同工作目录被调用，
 * 缓存实例可能指向错误的 repo root，导致加载错误的配置文件。
 * getFileConfigStore 仅用于 context-query（低频），性能不受影响。
 */
function getFileConfigStore() {
  const { FileConfigStore } = require("../../dist/src/persistence/file-config-store");
  const store = new FileConfigStore(findRepoRoot(process.cwd()));
  store.loadAll();
  return store;
}

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
  /** 返回全局知识 + 指定工作区的知识摘要。全局知识（scope=global, workspace_id IS NULL）对所有工作区可见。 */
  summary(workspaceId) {
    const db = openDb();
    try {
      const where = workspaceId ? "WHERE workspace_id = ? OR workspace_id IS NULL" : "";
      const params = workspaceId ? [workspaceId] : [];
      const rows = db.prepare(`SELECT scope, COUNT(*) as count FROM knowledge_library ${where} GROUP BY scope ORDER BY scope ASC`).all(...params);
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
        `SELECT kl.*, snippet(knowledge_library_search, 4, '[', ']', '...', 24) AS snippet
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
    const scope = params.scope ?? "workspace";
    if (scope === "workspace" && !params.workspaceId) {
      throw new Error("workspace_id is required when scope is 'workspace'");
    }
    const db = openDb();
    try {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO knowledge_library (id, scope, workspace_id, title, content, source_evolution_item_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, scope, params.workspaceId ?? null, params.title, params.content, params.sourceEvolutionItemId ?? null);
      reindexKnowledgeLibrary(db, id);
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
    "INSERT INTO knowledge_library_search (entry_id, scope, workspace_id, title, content) VALUES (?, ?, ?, ?, ?)"
  ).run(item.id, item.scope, item.workspace_id, item.title, item.content);
}

function toSearchResult(item) {
  return {
    id: item.id,
    scope: item.scope,
    workspace_id: item.workspace_id,
    title: item.title,
    content: item.content,
    snippet: item.content.slice(0, 240),
    source_evolution_item_id: item.source_evolution_item_id,
    updated_at: item.updated_at,
  };
}

function buildWhere(filters, prefix) {
  prefix = prefix || "";
  const clauses = [];
  const params = [];
  if (filters.scope) { clauses.push(`${prefix}scope = ?`); params.push(filters.scope); }
  if (filters.workspaceId !== undefined) {
    if (filters.workspaceId === null) {
      clauses.push(`${prefix}workspace_id IS NULL`);
    } else {
      clauses.push(`${prefix}workspace_id = ?`);
      params.push(filters.workspaceId);
    }
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", clauses, params };
}

// ── Issue Chain ─────────────────────────────────────────
const issueChain = {
  search(params) {
    const db = openDb();
    try {
      const query = params.query ?? "";
      const fts = query.trim() ? buildFtsQuery(query) : "*";
      const rows = db.prepare(
        `SELECT fi.feature_id, fi.title, fi.summary, fi.from_ids, fi.tags, fi.modules, fi.created_at,
                snippet(feature_chain_search, 2, '[', ']', '...', 24) AS snippet
         FROM feature_chain_search
         JOIN feature_chain_index fi ON fi.feature_id = feature_chain_search.feature_id
         WHERE feature_chain_search MATCH ?
         ORDER BY rank
         LIMIT ?`
      ).all(fts, params.limit ?? 10);
      return rows.map((r) => ({
        id: r.feature_id,
        title: r.title,
        summary: r.summary,
        tags: safeJson(r.tags, []),
        modules: safeJson(r.modules, []),
        from_ids: safeJson(r.from_ids, []),
        created_at: r.created_at,
        snippet: normalizeSnippet(r.snippet),
      }));
    } finally {
      db.close();
    }
  },

  get(id) {
    const db = openDb();
    try {
      const row = db.prepare("SELECT * FROM feature_chain_index WHERE feature_id = ?").get(id);
      if (!row) return null;
      let docContent = "";
      if (fs.existsSync(row.doc_path)) {
        docContent = fs.readFileSync(row.doc_path, "utf8");
      }
      return {
        id: row.feature_id,
        title: row.title,
        summary: row.summary,
        from_ids: safeJson(row.from_ids, []),
        tags: safeJson(row.tags, []),
        modules: safeJson(row.modules, []),
        doc_path: row.doc_path,
        created_at: row.created_at,
        doc_content: docContent,
      };
    } finally {
      db.close();
    }
  },

  chain(params) {
    const db = openDb();
    try {
      const featureId = params.id;
      const direction = params.direction ?? "both";
      const result = { feature_id: featureId, backward: [], forward: [] };
      // backward: from_ids 链（该 feature 引用了谁）
      if (direction === "backward" || direction === "both") {
        const row = db.prepare("SELECT from_ids FROM feature_chain_index WHERE feature_id = ?").get(featureId);
        if (row) {
          const ids = safeJson(row.from_ids, []);
          result.backward = ids.map((id) => {
            const ref = db.prepare("SELECT feature_id, title, summary FROM feature_chain_index WHERE feature_id = ?").get(id);
            return ref ? { id: ref.feature_id, title: ref.title, summary: ref.summary } : { id, title: "(unknown)", summary: "" };
          });
        }
      }
      // forward: 谁引用了该 feature
      if (direction === "forward" || direction === "both") {
        const refs = db.prepare(
          "SELECT fi.feature_id, fi.title, fi.summary FROM feature_chain_backlink b JOIN feature_chain_index fi ON fi.feature_id = b.from_feature_id WHERE b.feature_id = ?"
        ).all(featureId);
        result.forward = refs.map((r) => ({ id: r.feature_id, title: r.title, summary: r.summary }));
      }
      return result;
    } finally {
      db.close();
    }
  },
};

function safeJson(str, fallback) {
  if (typeof str !== "string") return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
/** 解析 conversation 范围：优先用 --issue-id 跨 conversation，否则用 --conversation-id */
function resolveConversationIds(db, params) {
  if (params.issueId) {
    return db.prepare("SELECT id FROM conversation WHERE feature_id = ? ORDER BY datetime(created_at) ASC").all(params.issueId).map(r => r.id);
  }
  if (params.conversationId) {
    return [params.conversationId];
  }
  return [];
}

const conversationHistory = {
  /** 全文搜索：支持 --issue-id 跨 conversation 或 --conversation-id 单 conversation */
  search(params) {
    const db = openDb();
    try {
      const convIds = resolveConversationIds(db, params);
      if (convIds.length === 0) return [];
      const ftsQuery = buildFtsQuery(params.query ?? "");
      const placeholders = convIds.map(() => "?").join(",");
      return db.prepare(
        `SELECT * FROM message_search WHERE message_search MATCH ? AND conversation_id IN (${placeholders}) ORDER BY rank LIMIT ?`
      ).all(ftsQuery, ...convIds, params.limit ?? 5).map(toMessageResult);
    } finally {
      db.close();
    }
  },

  /** 窗口查询：围绕锚点消息的上下文，需要 conversation_id */
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

  /** 按 ID 批量查询：需要 conversation_id */
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

  /** 最近对话：支持 --issue-id 跨 conversation 或 --conversation-id 单 conversation */
  recent(params) {
    const db = openDb();
    try {
      const convIds = resolveConversationIds(db, params);
      if (convIds.length === 0) return [];
      const limit = params.limit ?? 10;
      const result = [];
      const seen = new Set();
      for (const convId of convIds) {
        const userMessages = db.prepare(
          `SELECT id FROM message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT 3`
        ).all(convId);
        for (const um of userMessages) {
          const window = db.prepare(
            `SELECT id FROM message WHERE conversation_id = ? AND datetime(created_at) >= datetime((SELECT created_at FROM message WHERE id = ?)) ORDER BY datetime(created_at) ASC, id ASC`
          ).all(convId, um.id);
          for (const row of window) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              result.push(row.id);
            }
          }
        }
      }
      if (result.length === 0) return [];
      const placeholders = result.map(() => "?").join(",");
      const messages = db.prepare(
        `SELECT * FROM message WHERE id IN (${placeholders}) ORDER BY datetime(created_at) ASC, id ASC`
      ).all(...result).map(toMessageRow);
      return messages.slice(-limit);
    } finally {
      db.close();
    }
  },

  /** 分页查询：支持 --issue-id 跨 conversation 或 --conversation-id 单 conversation */
  page(params) {
    const db = openDb();
    try {
      const convIds = resolveConversationIds(db, params);
      if (convIds.length === 0) return [];
      const placeholders = convIds.map(() => "?").join(",");
      return db.prepare(
        `SELECT * FROM message WHERE conversation_id IN (${placeholders}) ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?`
      ).all(...convIds, params.limit ?? 50, params.offset ?? 0).map(toMessageRow);
    } finally {
      db.close();
    }
  },

  /** 重建索引：支持按 conversation_id 或全局重建 */
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


// ── Evolution Candidate ──────────────────────────────────
const evolutionCandidate = {
  create(input) {
    const db = openDb();
    const id = crypto.randomUUID();
    try {
      const tx = db.transaction(() => {
        db.prepare(
          "INSERT INTO evolution_item (id, workspace_id, title, content, tags, metadata) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(id, input.workspaceId, input.title, input.content, JSON.stringify(input.tags ?? []), input.metadata ?? null);
        /** 治理对话的 workspace_id 固定为 "evolution-center"，因为 stage definition 和角色定义
         *  都绑定在 evolution-center 工作区上。演进项自身的 workspace_id 仍为来源工作区。 */
        const issueId = crypto.randomUUID();
        db.prepare(
          "INSERT INTO issue (id, workspace_id, title, summary, task_anchor, role_snail_mapping) VALUES (?, ?, ?, NULL, NULL, '{}')"
        ).run(issueId, "evolution-center", input.title);
        const stageId = crypto.randomUUID();
        db.prepare(
          "INSERT INTO stage (id, workspace_id, feature_id, stage_definition_id, type, sequence, status, output_artifacts, entered_at) VALUES (?, ?, ?, 'evolution-center-development', 'development', 1, 'in_progress', '{}', datetime('now'))"
        ).run(stageId, "evolution-center", issueId);
        const convId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO conversation (id, workspace_id, feature_id, stage_id, kind, title, owner_type, owner_id, summary, status, default_role, participating_roles, from_conversation_ids)
           VALUES (?, ?, ?, ?, 'discussion', ?, 'evolution', ?, '治理对话', 'active', '演进执行者', '["项目负责人","演进执行者"]', '[]')`
           VALUES (?, ?, ?, ?, 'discussion', ?, 'evolution', ?, '治理对话', 'active', '演进执行者', '["项目负责人","演进执行者"]', '[]')`
        ).run(convId, "evolution-center", issueId, stageId, input.title, id);
        // 更新 evolution_item 的 feature_id
        db.prepare("UPDATE evolution_item SET feature_id = ? WHERE id = ?").run(issueId, id);
        // 重建 FTS 索引
        reindexEvolutionItem(db, id);
      });
      tx();
      const item = db.prepare("SELECT * FROM evolution_item WHERE id = ?").get(id);
      const conversation = db.prepare("SELECT id FROM conversation WHERE owner_type = 'evolution' AND owner_id = ?").get(id);
      return {
        ok: true,
        evolution_item_id: id,
        feature_id: item.feature_id,
        conversation_id: conversation?.id ?? null,
      };
    } finally {
      db.close();
    }
  },
};

function reindexEvolutionItem(db, evolutionItemId) {
  const item = db.prepare("SELECT * FROM evolution_item WHERE id = ?").get(evolutionItemId);
  if (!item) return;
  db.prepare("DELETE FROM evolution_item_search WHERE evolution_item_id = ?").run(evolutionItemId);
  db.prepare(
    "INSERT INTO evolution_item_search (evolution_item_id, workspace_id, title, content) VALUES (?, ?, ?, ?)"
  ).run(item.id, item.workspace_id, item.title, item.content);
}


// ── CLI entry (internal use by skill scripts) ────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  switch (args.mode) {
    case "knowledge-summary":
      result = { mode: "summary", categories: knowledgeLibrary.summary(args.workspaceId) };
      break;
    case "knowledge-list":
      result = { mode: "list", items: knowledgeLibrary.list({ scope: args.scope, workspaceId: args.workspaceId, query: args.query, limit: args.limit, offset: args.offset }) };
      break;
    case "knowledge-get":
      if (!args.id) fail("--id is required");
      result = { mode: "get", entry: knowledgeLibrary.get(args.id) };
      break;
    case "knowledge-search":
      if (!args.query) fail("--query is required");
      result = { mode: "search", query: args.query, items: knowledgeLibrary.search({ scope: args.scope, workspaceId: args.workspaceId, query: args.query, limit: args.limit, offset: args.offset }) };
      break;
    case "knowledge-create":
      if (!args.title || !args.content) fail("--title and --content are required");
      result = knowledgeLibrary.create({ scope: args.scope ?? "workspace", workspaceId: args.workspaceId, title: args.title, content: args.content, sourceEvolutionItemId: args.sourceEvolutionItemId });
      break;
    case "history-search":
      result = { mode: "search", query: args.query, feature_id: args.issueId || null, messages: conversationHistory.search({ issueId: args.issueId, conversationId: args.conversationId, query: args.query, limit: args.limit }) };
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
      result = { mode: "recent", feature_id: args.issueId || null, messages: conversationHistory.recent({ issueId: args.issueId, conversationId: args.conversationId, limit: args.limit }) };
      break;
    case "history-page":
      result = { mode: "page", feature_id: args.issueId || null, messages: conversationHistory.page({ issueId: args.issueId, conversationId: args.conversationId, limit: args.limit, offset: args.offset }) };
      break;
    case "history-reindex":
      result = { mode: "reindex", conversation_id: args.conversationId || null, ...conversationHistory.reindex({ conversationId: args.conversationId }) };
      break;
    case "evolution-create":
      if (!args.workspaceId) fail("--workspace-id is required");
      if (!args.title) fail("--title is required");
      if (!args.content) fail("--content is required");
      result = evolutionCandidate.create({
        workspaceId: args.workspaceId,
        title: args.title,
        content: args.content,
        tags: args.tags ? JSON.parse(args.tags) : [],
        metadata: args.metadata ?? null,
      });
      break;
    case "feature-chain-search":
      if (!args.query) fail("--query is required");
      result = { mode: "search", query: args.query, items: issueChain.search({ query: args.query, limit: args.limit }) };
      break;
    case "feature-chain-get":
      if (!args.id) fail("--id is required");
      result = { mode: "get", entry: issueChain.get(args.id) };
      break;
    case "feature-chain-chain":
      if (!args.id) fail("--id is required");
      result = issueChain.chain({ id: args.id, direction: args.direction });
      break;
    case "issue-set-task-anchor": {
      if (!args.issueId) fail("--issue-id is required");
      if (!args.taskAnchor) fail("--task-anchor is required");
      const db = openDb();
      try {
        const issue = db.prepare("SELECT * FROM issue WHERE id = ?").get(args.issueId);
        if (!issue) fail(`Issue not found: ${args.issueId}`);
        if (issue.closed_at) fail("Archived issue is read-only");
        db.prepare("UPDATE issue SET task_anchor = ?, updated_at = datetime('now') WHERE id = ?").run(args.taskAnchor, args.issueId);
        const updated = db.prepare("SELECT * FROM issue WHERE id = ?").get(args.issueId);
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
        const issue = db.prepare("SELECT * FROM issue WHERE id = ?").get(stage.feature_id);
        if (!issue) fail(`Issue not found: ${stage.feature_id}`);
        if (issue.closed_at) fail("Archived issue is read-only");
        let current = {};
        try { current = JSON.parse(stage.output_artifacts || "{}"); } catch (_) {}
        const entries = JSON.parse(args.entries);
        const updated = { ...current, ...entries };
        db.prepare("UPDATE stage SET output_artifacts = ? WHERE id = ?").run(JSON.stringify(updated), args.stageId);
        result = { stage_id: stage.id, feature_id: stage.feature_id, issue_title: issue.title, stage_type: stage.type, output_artifacts: updated };
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
            const fcs = getFileConfigStore();
            stageDef = fcs.getSopStageDefinition(stage.stage_definition_id) ?? null;
            stageRoles = stageDef ? fcs.listSopStageRoleDefinitions(stageDef.id) : [];
            if (stage.sequence > 1) {
              const prevStage = db.prepare("SELECT * FROM stage WHERE feature_id = ? AND sequence = ?").get(stage.feature_id, stage.sequence - 1);
              if (prevStage) { try { inputArtifacts = JSON.parse(prevStage.output_artifacts || "{}"); } catch (_) {} }
            }
          }
        }
        let issue = null;
        if (conv.feature_id) issue = db.prepare("SELECT * FROM issue WHERE id = ?").get(conv.feature_id);
        let workspace = null;
        if (conv.workspace_id) workspace = getFileConfigStore().getWorkspace(conv.workspace_id) ?? null;
        // Parse JSON fields for message_contexts
        try { conv.participating_roles = JSON.parse(conv.participating_roles || "[]"); } catch (_) { conv.participating_roles = []; }
        try { conv.from_conversation_ids = JSON.parse(conv.from_conversation_ids || "[]"); } catch (_) { conv.from_conversation_ids = []; }
        if (stageDef) { try { stageDef.acceptance_focus = JSON.parse(stageDef.acceptance_focus || "[]"); } catch (_) { stageDef.acceptance_focus = []; } }
        stageRoles.forEach((r) => { try { r.working_rules = JSON.parse(r.working_rules || "[]"); } catch (_) { r.working_rules = []; } });
        try { stage.output_artifacts = JSON.parse(stage?.output_artifacts || "{}"); } catch (_) { stage.output_artifacts = {}; }
        result = { conv, stage, stageDef, stageRoles, issue, workspace, inputArtifacts };
      } finally { db.close(); }
      break;
    }
    case "stage-get-active": {
      if (!args.issueId) fail("--issue-id is required");
      const db = openDb();
      try {
        const stage = db.prepare(
          "SELECT * FROM stage WHERE feature_id = ? AND status = 'in_progress' ORDER BY sequence DESC LIMIT 1"
        ).get(args.issueId);
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
    scope: optStr("--scope"),
    workspaceId: hasArg("--workspace-id") ? parseNullable(getValue("--workspace-id")) : undefined,
    id: optStr("--id"),
    title: optStr("--title"),
    content: optStr("--content"),
    sourceEvolutionItemId: optStr("--source-evolution-item-id"),
    query: optStr("--query"),
    conversationId: optStr("--conversation-id"),
    anchorMessageId: optStr("--anchor-message-id"),
    messageIds: optStr("--message-ids"),
    before: toPositiveInt(getValue("--before"), 2),
    after: toPositiveInt(getValue("--after"), 2),
    direction: optStr("--direction"),
    limit: toPositiveInt(getValue("--limit"), 50),
    offset: toPositiveInt(getValue("--offset"), 0),
    metadata: optStr("--metadata"),
    tags: optStr("--tags"),
    issueId: optStr("--issue-id"),
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

module.exports = { knowledgeLibrary, conversationHistory, evolutionCandidate, issueChain, resolveDbPath };
