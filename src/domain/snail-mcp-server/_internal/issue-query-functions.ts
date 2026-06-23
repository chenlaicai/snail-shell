import type { SQLiteDatabase } from "@infra/database";
import type {
  ConversationContextResult,
  HistoryMessage,
  EvolutionCandidateResult,
  FeatureChainResult,
} from "@domain/snail-mcp-server/_internal/servers/snail-issue";
import type { EvolutionPort } from "@domain/evolution/port";
import type { IssuePort } from "@domain/issue/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";

// ── Conversation Context Query ────────────────────────────────────────

export function createQueryConversationContext(db: SQLiteDatabase) {
  return (conversationId: string): ConversationContextResult => {
    const conv = db.get<Record<string, unknown>>(`SELECT * FROM conversation WHERE id = ?`, [conversationId]);
    if (!conv) throw new Error(`Conversation not found: ${conversationId}`);
    parseJsonFields(conv, ["participating_roles", "from_conversation_ids"], [[], []]);
    const stage = loadStageContext(db, conv.stage_id as string | undefined);
    const issue = loadIssueContext(db, conv.issue_id as string | undefined);
    return { conv, stage: stage.stage, stageDef: null, stageRoles: [], issue, workspace: null, inputArtifacts: stage.inputArtifacts };
  };
}

function parseJsonFields(obj: Record<string, unknown>, keys: string[], fallbacks: unknown[]) {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try { obj[key] = JSON.parse(obj[key] as string || "null") ?? fallbacks[i]; } catch { obj[key] = fallbacks[i]; }
  }
}

function loadStageContext(db: SQLiteDatabase, stageId: string | undefined) {
  let inputArtifacts: Record<string, unknown> = {};
  if (!stageId) return { stage: null as Record<string, unknown> | null, inputArtifacts };
  const stage = db.get<Record<string, unknown>>(`SELECT * FROM stage WHERE id = ?`, [stageId]) ?? null;
  if (!stage) return { stage, inputArtifacts };
  parseJsonFields(stage, ["role_instances", "available_transitions", "output_artifacts"], [[], [], {}]);
  if (typeof stage.sequence === "number" && stage.sequence > 1) {
    const prev = db.get<Record<string, unknown>>(`SELECT output_artifacts FROM stage WHERE issue_id = ? AND sequence = ?`, [stage.issue_id, stage.sequence - 1]);
    if (prev) try { inputArtifacts = JSON.parse((prev.output_artifacts as string) || "{}"); } catch { /* noop */ }
  }
  return { stage, inputArtifacts };
}

function loadIssueContext(db: SQLiteDatabase, issueId: string | undefined) {
  if (!issueId) return null;
  const issue = db.get<Record<string, unknown>>(`SELECT * FROM issue WHERE id = ?`, [issueId]) ?? null;
  if (issue) parseJsonFields(issue, ["sop_snapshot", "snail_assignment_plan", "extendable_context"], [{}, {}, {}]);
  return issue;
}

// ── Conversation History Query ────────────────────────────────────────

export function createQueryConversationHistory(db: SQLiteDatabase) {
  function resolveConversationIds(issueId?: string, conversationId?: string): string[] {
    if (issueId) return db.all<{ id: string }>(`SELECT id FROM conversation WHERE issue_id = ? ORDER BY datetime(created_at) ASC`, [issueId]).map(r => r.id);
    if (conversationId) return [conversationId];
    return [];
  }

  const toMessageRow = (row: Record<string, unknown>): HistoryMessage => ({
    id: row.id as number, conversation_id: row.conversation_id as string, role: row.role as string,
    from_role: (row.from_role as string) ?? null, content: row.content as string, created_at: row.created_at as string,
  });

  const handlers: Record<string, (params: HistoryParams) => unknown> = {
    search: (params) => {
      const convIds = resolveConversationIds(params.issueId, params.conversationId);
      if (convIds.length === 0) return { mode: "search", messages: [] };
      const placeholders = convIds.map(() => "?").join(",");
      return { mode: "search", query: params.query, messages: db.all<Record<string, unknown>>(
        `SELECT * FROM message_search WHERE message_search MATCH ? AND conversation_id IN (${placeholders}) ORDER BY rank LIMIT ?`,
        [buildFtsQuery(params.query ?? ""), ...convIds, params.limit ?? 5],
      ).map(toMessageRow) };
    },
    recent: (params) => {
      const convIds = resolveConversationIds(params.issueId, params.conversationId);
      if (convIds.length === 0) return { mode: "recent", messages: [] };
      return { mode: "recent", messages: fetchRecent(db, convIds, params.limit ?? 10, toMessageRow) };
    },
    page: (params) => {
      const convIds = resolveConversationIds(params.issueId, params.conversationId);
      if (convIds.length === 0) return { mode: "page", messages: [] };
      const placeholders = convIds.map(() => "?").join(",");
      return { mode: "page", messages: db.all<Record<string, unknown>>(
        `SELECT * FROM message WHERE conversation_id IN (${placeholders}) ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?`,
        [...convIds, params.limit ?? 50, params.offset ?? 0],
      ).map(toMessageRow) };
    },
    window: (params) => {
      if (!params.anchorMessageId || !params.conversationId) throw new Error("anchor_message_id and conversation_id required");
      return { mode: "window", messages: fetchWindow(db, { convId: params.conversationId, anchorId: params.anchorMessageId, before: params.before ?? 2, after: params.after ?? 2 }, toMessageRow) };
    },
    "by-ids": (params) => {
      if (!params.messageIds?.length) return { mode: "by-ids", messages: [] };
      if (!params.conversationId) throw new Error("conversation_id required");
      const placeholders = params.messageIds.map(() => "?").join(",");
      return { mode: "by-ids", messages: db.all<Record<string, unknown>>(
        `SELECT * FROM message WHERE id IN (${placeholders}) AND conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC`,
        [...params.messageIds, params.conversationId],
      ).map(toMessageRow) };
    },
  };

  return (params: HistoryParams): unknown => {
    const handler = handlers[params.mode];
    if (!handler) throw new Error(`Unknown conversation history mode: ${params.mode}`);
    return handler(params);
  };
}

interface HistoryParams {
  mode: string; issueId?: string; conversationId?: string; query?: string;
  limit?: number; offset?: number; anchorMessageId?: number; before?: number; after?: number; messageIds?: string[];
}

function fetchRecent(db: SQLiteDatabase, convIds: string[], limit: number, map: (r: Record<string, unknown>) => HistoryMessage) {
  const result: HistoryMessage[] = [];
  const seen = new Set<number>();
  for (const convId of convIds) {
    for (const um of db.all<{ id: number }>(`SELECT id FROM message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT 3`, [convId])) {
      if (seen.has(um.id)) continue;
      seen.add(um.id);
      result.push(...db.all<Record<string, unknown>>(
        `SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) >= datetime((SELECT created_at FROM message WHERE id = ?)) ORDER BY datetime(created_at) ASC, id ASC`,
        [convId, um.id],
      ).map(map));
      if (result.length >= limit) return result.slice(0, limit);
    }
  }
  return result;
}

interface WindowParams { convId: string; anchorId: number; before: number; after: number; }

function fetchWindow(db: SQLiteDatabase, p: WindowParams, map: (r: Record<string, unknown>) => HistoryMessage) {
  const msg = db.get<{ created_at: string }>(`SELECT created_at FROM message WHERE id = ? AND conversation_id = ?`, [p.anchorId, p.convId]);
  if (!msg) return [];
  const beforeRows = db.all<Record<string, unknown>>(
    `SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) < datetime(?) ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`,
    [p.convId, msg.created_at, p.before],
  ).reverse().map(map);
  const afterRows = db.all<Record<string, unknown>>(
    `SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) >= datetime(?) AND id != ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ?`,
    [p.convId, msg.created_at, p.anchorId, p.after + 1],
  ).map(map);
  return [...beforeRows, ...afterRows];
}

// ── Evolution Candidate Creation ──────────────────────────────────────

export function createCreateEvolutionCandidate(evolutionPort: EvolutionPort, collaboration: CollaborationInput, issuePort: IssuePort) {
  return async (params: { workspaceId: string; title: string; content: string; tags?: string[]; metadata?: unknown }): Promise<EvolutionCandidateResult> => {
    const item = evolutionPort.create({ workspace_id: params.workspaceId, title: params.title, content: params.content, tags: params.tags, metadata: params.metadata });
    const { issue, stage } = await collaboration.createIssue({
      workspace_path: params.workspaceId, title: `[Evolution] ${params.title}`, summary: params.content,
      adopted_sop_key: "evolution", snail_assignment_plan: buildEvolutionPlan(issuePort, params.title),
      extendable_context: { evolution_item_id: item.id },
    });
    evolutionPort.update(item.id, { status: "in_progress" });
    return { ok: true, evolution_item_id: item.id, issue_id: issue.id, conversation_id: stage.id };
  };
}

function buildEvolutionPlan(issuePort: IssuePort, title: string) {
  const plan: Record<string, Record<string, string>> = {};
  for (const stage of issuePort.previewSopStages("evolution", title)) {
    plan[stage.key] = {};
    for (const role of stage.role_instances) plan[stage.key][role.role_instance] = "default";
  }
  return plan;
}

// ── Feature Chain Search ──────────────────────────────────────────────

export function createSearchFeatureChain(db: SQLiteDatabase) {
  const handlers: Record<string, (params: FeatureChainParams) => FeatureChainResult> = {
    search: (params) => {
      if (!params.query) throw new Error("query required");
      return { mode: "search", items: db.all<Record<string, unknown>>(
        `SELECT feature_id, title, summary, tags, modules, snippet(feature_search, 0, '<b>', '</b>', '...', 32) as snippet FROM feature_search WHERE feature_search MATCH ? ORDER BY rank LIMIT ?`,
        [buildFtsQuery(params.query), params.limit ?? 10],
      ) };
    },
    get: (params) => {
      if (!params.id) throw new Error("id required");
      return { mode: "get", entry: db.get(`SELECT * FROM feature WHERE feature_id = ?`, [params.id]) };
    },
    chain: (params) => {
      if (!params.id) throw new Error("id required");
      return { mode: "chain", chain: fetchChain(db, params.id, params.direction ?? "backward") };
    },
  };

  return (params: FeatureChainParams): FeatureChainResult => {
    const handler = handlers[params.mode];
    if (!handler) throw new Error(`Unknown feature chain mode: ${params.mode}`);
    return handler(params);
  };
}

interface FeatureChainParams { mode: string; query?: string; id?: string; direction?: string; limit?: number; }

function fetchChain(db: SQLiteDatabase, featureId: string, direction: string) {
  const result: { backward: unknown[]; forward: unknown[] } = { backward: [], forward: [] };
  if (direction === "backward" || direction === "both") {
    const entry = db.get<{ from_ids: string }>(`SELECT from_ids FROM feature WHERE feature_id = ?`, [featureId]);
    if (entry?.from_ids) {
      const ids = JSON.parse(entry.from_ids);
      if (Array.isArray(ids) && ids.length > 0) {
        result.backward = db.all(`SELECT feature_id, title, summary FROM feature WHERE feature_id IN (${ids.map(() => "?").join(",")})`, ids);
      }
    }
  }
  if (direction === "forward" || direction === "both") {
    result.forward = db.all(`SELECT feature_id, title, summary FROM feature WHERE from_ids LIKE ?`, [`%${featureId}%`]);
  }
  return direction === "both" ? result : direction === "backward" ? result.backward : result.forward;
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildFtsQuery(query: string): string {
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return "*";
  return terms.map(t => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}
