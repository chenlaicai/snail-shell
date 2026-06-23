import type { SQLiteDatabase } from "@infra/database";
import type { ConversationContextResult, HistoryMessage, EvolutionCandidateResult, FeatureChainResult } from "@domain/snail-mcp-server/_internal/servers/snail-issue";
import type { EvolutionPort } from "@domain/evolution/port";
import type { IssuePort } from "@domain/issue/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";

export function createQueryConversationContext(db: SQLiteDatabase) {
  return (conversationId: string): ConversationContextResult => {
    const conv = db.get<Record<string, unknown>>(`SELECT * FROM conversation WHERE id = ?`, [conversationId]);
    if (!conv) throw new Error(`Conversation not found: ${conversationId}`);
    parseJson(conv, ["participating_roles", "from_conversation_ids"], [[], []]);
    const issue = loadIssue(db, conv.issue_id as string | undefined);
    const stage = loadStage(db, conv.stage_id as string | undefined);
    const { stageDef, stageRoles } = resolveStageDefinition(issue, stage?.stage);
    const workspace = loadWorkspace(db, conv.workspace_id as string | undefined);
    return { conv, stage: stage?.stage ?? null, stageDef, stageRoles, issue, workspace, inputArtifacts: stage?.inputArtifacts ?? {} };
  };
}

function parseJson(obj: Record<string, unknown>, keys: string[], fallbacks: unknown[]) {
  for (let i = 0; i < keys.length; i++) {
    try { obj[keys[i]] = JSON.parse(obj[keys[i]] as string || "null") ?? fallbacks[i]; } catch { obj[keys[i]] = fallbacks[i]; }
  }
}

function loadStage(db: SQLiteDatabase, stageId: string | undefined) {
  let inputArtifacts: Record<string, unknown> = {};
  if (!stageId) return { stage: null as Record<string, unknown> | null, inputArtifacts };
  const stage = db.get<Record<string, unknown>>(`SELECT * FROM stage WHERE id = ?`, [stageId]) ?? null;
  if (!stage) return { stage, inputArtifacts };
  parseJson(stage, ["role_instances", "available_transitions", "output_artifacts"], [[], [], {}]);
  if (typeof stage.sequence === "number" && stage.sequence > 1) {
    const prev = db.get<Record<string, unknown>>(`SELECT output_artifacts FROM stage WHERE issue_id = ? AND sequence = ?`, [stage.issue_id, stage.sequence - 1]);
    if (prev) try { inputArtifacts = JSON.parse((prev.output_artifacts as string) || "{}"); } catch { /* noop */ }
  }
  return { stage, inputArtifacts };
}

function loadIssue(db: SQLiteDatabase, issueId: string | undefined) {
  if (!issueId) return null;
  const issue = db.get<Record<string, unknown>>(`SELECT * FROM issue WHERE id = ?`, [issueId]) ?? null;
  if (issue) parseJson(issue, ["sop_snapshot", "snail_assignment_plan", "extendable_context"], [{}, {}, {}]);
  return issue;
}

function loadWorkspace(db: SQLiteDatabase, workspaceId: string | undefined) {
  if (!workspaceId) return null;
  return db.get<Record<string, unknown>>(`SELECT * FROM workspace WHERE id = ?`, [workspaceId]) ?? null;
}

function resolveStageDefinition(issue: Record<string, unknown> | null, stage: Record<string, unknown> | null) {
  if (!issue || !stage) return { stageDef: null, stageRoles: [] };
  const sopSnapshot = issue.sop_snapshot as Record<string, unknown> | undefined;
  if (!sopSnapshot) return { stageDef: null, stageRoles: [] };
  const stageDefs = sopSnapshot.stage_definitions as Record<string, unknown>[] | undefined;
  if (!stageDefs) return { stageDef: null, stageRoles: [] };
  const stageKey = stage.key as string;
  const stageDef = stageDefs.find(sd => sd.key === stageKey) ?? null;
  if (!stageDef) return { stageDef: null, stageRoles: [] };
  const roles = (stageDef.roles as Record<string, unknown>[] | undefined) ?? [];
  const stageRoles = roles.map(r => {
    try { if (typeof r.working_rules === "string") r.working_rules = JSON.parse(r.working_rules); } catch { /* noop */ }
    return r;
  });
  return { stageDef, stageRoles };
}

export function createQueryConversationHistory(db: SQLiteDatabase) {
  function resolveConvIds(issueId?: string, conversationId?: string): string[] {
    if (issueId) return db.all<{ id: string }>(`SELECT id FROM conversation WHERE issue_id = ? ORDER BY datetime(created_at) ASC`, [issueId]).map(r => r.id);
    if (conversationId) return [conversationId];
    return [];
  }
  const map = (row: Record<string, unknown>): HistoryMessage => ({
    id: row.id as number, conversation_id: row.conversation_id as string, role: row.role as string,
    from_role: (row.from_role as string) ?? null, content: row.content as string, created_at: row.created_at as string,
  });
  const handlers: Record<string, (p: HistoryParams) => unknown> = {
    search: (p) => {
      const ids = resolveConvIds(p.issueId, p.conversationId);
      if (!ids.length) return { mode: "search", messages: [] };
      return { mode: "search", query: p.query, messages: db.all<Record<string, unknown>>(
        `SELECT * FROM message_search WHERE message_search MATCH ? AND conversation_id IN (${ids.map(() => "?").join(",")}) ORDER BY rank LIMIT ?`,
        [ftsQuery(p.query ?? ""), ...ids, p.limit ?? 5],
      ).map(map) };
    },
    recent: (p) => {
      const ids = resolveConvIds(p.issueId, p.conversationId);
      if (!ids.length) return { mode: "recent", messages: [] };
      return { mode: "recent", messages: fetchRecent(db, ids, p.limit ?? 10, map) };
    },
    page: (p) => {
      const ids = resolveConvIds(p.issueId, p.conversationId);
      if (!ids.length) return { mode: "page", messages: [] };
      return { mode: "page", messages: db.all<Record<string, unknown>>(
        `SELECT * FROM message WHERE conversation_id IN (${ids.map(() => "?").join(",")}) ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?`,
        [...ids, p.limit ?? 50, p.offset ?? 0],
      ).map(map) };
    },
    window: (p) => {
      if (!p.anchorMessageId || !p.conversationId) throw new Error("anchor_message_id and conversation_id required");
      return { mode: "window", messages: fetchWindow(db, { convId: p.conversationId, anchorId: p.anchorMessageId, before: p.before ?? 2, after: p.after ?? 2 }, map) };
    },
    "by-ids": (p) => {
      if (!p.messageIds?.length) return { mode: "by-ids", messages: [] };
      if (!p.conversationId) throw new Error("conversation_id required");
      return { mode: "by-ids", messages: db.all<Record<string, unknown>>(
        `SELECT * FROM message WHERE id IN (${p.messageIds.map(() => "?").join(",")}) AND conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC`,
        [...p.messageIds, p.conversationId],
      ).map(map) };
    },
    reindex: (p) => ({ mode: "reindex", ...reindexMessages(db, p.conversationId) }),
  };
  return (params: HistoryParams): unknown => {
    const h = handlers[params.mode];
    if (!h) throw new Error(`Unknown mode: ${params.mode}`);
    return h(params);
  };
}

interface HistoryParams { mode: string; issueId?: string; conversationId?: string; query?: string; limit?: number; offset?: number; anchorMessageId?: number; before?: number; after?: number; messageIds?: string[]; }

function fetchRecent(db: SQLiteDatabase, convIds: string[], limit: number, map: (r: Record<string, unknown>) => HistoryMessage) {
  const result: HistoryMessage[] = [];
  const seen = new Set<number>();
  for (const cid of convIds) {
    for (const um of db.all<{ id: number }>(`SELECT id FROM message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT 3`, [cid])) {
      if (seen.has(um.id)) continue; seen.add(um.id);
      result.push(...db.all<Record<string, unknown>>(
        `SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) >= datetime((SELECT created_at FROM message WHERE id = ?)) ORDER BY datetime(created_at) ASC, id ASC`,
        [cid, um.id],
      ).map(map));
      if (result.length >= limit) return result.slice(0, limit);
    }
  }
  return result;
}

interface WindowOpts { convId: string; anchorId: number; before: number; after: number; }

function fetchWindow(db: SQLiteDatabase, opts: WindowOpts, map: (r: Record<string, unknown>) => HistoryMessage) {
  const msg = db.get<{ created_at: string }>(`SELECT created_at FROM message WHERE id = ? AND conversation_id = ?`, [opts.anchorId, opts.convId]);
  if (!msg) return [];
  const b = db.all<Record<string, unknown>>(`SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) < datetime(?) ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`, [opts.convId, msg.created_at, opts.before]).reverse().map(map);
  const a = db.all<Record<string, unknown>>(`SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) >= datetime(?) AND id != ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ?`, [opts.convId, msg.created_at, opts.anchorId, opts.after + 1]).map(map);
  return [...b, ...a];
}

export function makeEvolutionCandidateCreator(evolutionPort: EvolutionPort, collaboration: CollaborationInput, issuePort: IssuePort) {
  return async (params: { workspaceId: string; title: string; content: string; tags?: string[]; metadata?: unknown }): Promise<EvolutionCandidateResult> => {
    const item = evolutionPort.create({ workspace_id: params.workspaceId, title: params.title, content: params.content, tags: params.tags, metadata: params.metadata });
    try {
      const { issue, stage } = await collaboration.createIssue({
        workspace_path: params.workspaceId, title: `[Evolution] ${params.title}`, summary: params.content,
        adopted_sop_key: "evolution", snail_assignment_plan: buildPlan(issuePort, params.title),
        extendable_context: { evolution_item_id: item.id },
      });
      evolutionPort.update(item.id, { status: "in_progress" });
      return { ok: true, evolution_item_id: item.id, issue_id: issue.id, conversation_id: stage.id };
    } catch (err) {
      evolutionPort.update(item.id, { status: "failed", result: `创建 issue 失败: ${err instanceof Error ? err.message : String(err)}` });
      throw err;
    }
  };
}

function buildPlan(issuePort: IssuePort, title: string) {
  const plan: Record<string, Record<string, string>> = {};
  for (const s of issuePort.previewSopStages("evolution", title)) { plan[s.key] = {}; for (const r of s.role_instances) plan[s.key][r.role_instance] = "default"; }
  return plan;
}

export function createSearchFeatureChain(db: SQLiteDatabase) {
  const handlers: Record<string, (p: FCParams) => FeatureChainResult> = {
    search: (p) => { if (!p.query) throw new Error("query required"); return { mode: "search", items: db.all(`SELECT feature_id, title, summary, tags, modules, snippet(feature_search, 0, '<b>', '</b>', '...', 32) as snippet FROM feature_search WHERE feature_search MATCH ? ORDER BY rank LIMIT ?`, [ftsQuery(p.query), p.limit ?? 10]) }; },
    get: (p) => { if (!p.id) throw new Error("id required"); return { mode: "get", entry: db.get(`SELECT * FROM feature WHERE feature_id = ?`, [p.id]) }; },
    chain: (p) => { if (!p.id) throw new Error("id required"); return { mode: "chain", chain: fetchChain(db, p.id, p.direction ?? "backward") }; },
  };
  return (params: FCParams): FeatureChainResult => { const h = handlers[params.mode]; if (!h) throw new Error(`Unknown mode: ${params.mode}`); return h(params); };
}

interface FCParams { mode: string; query?: string; id?: string; direction?: string; limit?: number; }

function fetchChain(db: SQLiteDatabase, fid: string, dir: string) {
  const r: { backward: unknown[]; forward: unknown[] } = { backward: [], forward: [] };
  if (dir === "backward" || dir === "both") {
    const e = db.get<{ from_ids: string }>(`SELECT from_ids FROM feature WHERE feature_id = ?`, [fid]);
    if (e?.from_ids) { const ids = JSON.parse(e.from_ids); if (Array.isArray(ids) && ids.length) r.backward = db.all(`SELECT feature_id, title, summary FROM feature WHERE feature_id IN (${ids.map(() => "?").join(",")})`, ids); }
  }
  if (dir === "forward" || dir === "both") r.forward = db.all(`SELECT feature_id, title, summary FROM feature WHERE from_ids LIKE ? ESCAPE '\\'`, [`%${fid.replace(/[%_\\]/g, "\\$&")}%`]);
  return dir === "both" ? r : dir === "backward" ? r.backward : r.forward;
}

function ftsQuery(q: string): string { const t = q.split(/\s+/).filter(Boolean); return t.length ? t.map(w => `"${w.replace(/"/g, '""')}"`).join(" AND ") : "*"; }

function reindexMessages(db: SQLiteDatabase, conversationId?: string) {
  const targetMessages = conversationId
    ? db.all<{ id: number }>(`SELECT id FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC`, [conversationId])
    : db.all<{ id: number }>(`SELECT id FROM message ORDER BY datetime(created_at) ASC, id ASC`);
  const indexed = db.transaction(() => {
    if (conversationId) db.run(`DELETE FROM message_search WHERE conversation_id = ?`, [conversationId]);
    else db.run(`DELETE FROM message_search`);
    let count = 0;
    for (const msg of targetMessages) {
      const row = db.get<Record<string, unknown>>(`SELECT * FROM message WHERE id = ?`, [msg.id]);
      if (!row) continue;
      const events = db.all<Record<string, unknown>>(`SELECT * FROM message_event WHERE message_id = ? ORDER BY seq ASC`, [row.id]);
      const content = buildSearchableContent(row.role as string, events);
      if (!content) continue;
      db.run(`DELETE FROM message_search WHERE message_id = ?`, [String(row.id)]);
      db.run(`INSERT INTO message_search (conversation_id, message_id, role, from_role, content) VALUES (?, ?, ?, ?, ?)`, [row.conversation_id, String(row.id), row.role, row.from_role, content]);
      count++;
    }
    return count;
  });
  return { conversation_id: conversationId ?? null, indexed_messages: indexed };
}

function buildSearchableContent(role: string, events: Record<string, unknown>[]): string {
  const parts = [role];
  for (const event of events) {
    const text = extractEventText(event);
    if (text) parts.push(text);
  }
  return parts.filter(Boolean).join(" ").trim() || "";
}

function extractEventText(event: Record<string, unknown>): string {
  const kind = event.kind as string;
  let payload = event.payload;
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return ""; } }
  const p = (payload ?? {}) as Record<string, unknown>;
  const extractors: Record<string, (r: Record<string, unknown>) => string> = {
    text: r => r.text as string ?? "",
    tool_call: r => r.tool_name as string ?? "",
    tool_result: r => r.output_text as string ?? "",
    command: r => r.command as string ?? "",
    command_result: r => r.output_text as string ?? "",
    error: r => r.message as string ?? "",
    content_block: r => r.fallback_text as string ?? "",
  };
  return extractors[kind]?.(p) ?? "";
}
