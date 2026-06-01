import type express from "express";
import type { WorkspaceManager } from "../../workspace-workflow/manager";

export function registerKnowledgeRoutes(
  router: express.Router,
  workspaceManager: WorkspaceManager,
): void {
  /** GET /knowledge/items/summary — 按 scope 返回条目数 */
  router.get("/knowledge/items/summary", (_req, res) => {
    const summary = workspaceManager.getKnowledgeLibrarySummary();
    const result: Record<string, number> = {};
    for (const row of summary) {
      result[row.scope] = row.count;
    }
    res.json(result);
  });

  /** GET /knowledge/items — 列表查询，支持 scope 和 workspace_id 筛选 */
  router.get("/knowledge/items", (req, res) => {
    const filters = parseListFilters(req.query);
    res.json(workspaceManager.listKnowledgeLibrary(filters));
  });

  /** GET /knowledge/items/search — 全文搜索 */
  router.get("/knowledge/items/search", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!query) {
      res.json([]);
      return;
    }
    res.json(workspaceManager.searchKnowledgeLibrary({ query, limit: 50 }));
  });

  /** GET /knowledge/items/:id — 详情查询 */
  router.get("/knowledge/items/:id", (req, res) => {
    const item = workspaceManager.getKnowledgeLibraryEntry(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Knowledge entry not found" });
      return;
    }
    res.json(item);
  });
}

const ALLOWED_SCOPES = ["global", "workspace"];

function parseListFilters(query: any): {
  scope?: string;
  workspaceId?: string | null;
  limit?: number;
  offset?: number;
} {
  const rawScope = typeof query.scope === "string" ? query.scope.trim() : undefined;
  const scope = rawScope && ALLOWED_SCOPES.includes(rawScope) ? rawScope : undefined;
  const workspaceId = typeof query.workspace_id === "string" ? query.workspace_id.trim() : undefined;
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { scope, workspaceId, limit, offset };
}
