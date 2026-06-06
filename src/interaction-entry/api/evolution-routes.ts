import type express from "express";
import type { WorkspaceManager } from "../../workspace-workflow/manager";

export function registerEvolutionRoutes(
  router: express.Router,
  workspaceManager: WorkspaceManager,
): void {
  registerEvolutionReadRoutes(router, workspaceManager);
  registerEvolutionMutationRoutes(router, workspaceManager);
}

function registerEvolutionReadRoutes(
  router: express.Router,
  workspaceManager: WorkspaceManager,
): void {
  router.get("/evolution/items", (req, res) => {
    res.json(workspaceManager.listEvolutionItems(parseFilters(req.query)));
  });

  router.get("/workspaces/:workspaceId/evolution/items", (req, res) => {
    res.json(
      workspaceManager.listEvolutionItems({
        ...parseFilters(req.query),
        workspaceId: req.params.workspaceId,
      }),
    );
  });

  router.get("/evolution/items/:itemId", (req, res) => {
    const item = workspaceManager.getEvolutionItem(req.params.itemId);
    if (!item) {
      res.status(404).json({ error: "Evolution item not found" });
      return;
    }
    res.json(item);
  });
}

function registerEvolutionMutationRoutes(
  router: express.Router,
  workspaceManager: WorkspaceManager,
): void {
  router.post("/evolution/items", (req, res) => {
    const { role_snail_mapping, ...body } = req.body ?? {};
    const parsed = parseCreateBody(body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (!role_snail_mapping || typeof role_snail_mapping !== "object") {
      res.status(400).json({ error: "role_snail_mapping is required" });
      return;
    }
    res.status(201).json(workspaceManager.createEvolutionItem(parsed.value, role_snail_mapping));
  });

  router.patch("/evolution/items/:itemId", (req, res) => {
    try {
      const parsed = parseUpdateBody(req.body ?? {});
      res.json(
        workspaceManager.updateEvolutionItem(req.params.itemId, parsed),
      );
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });
}

function getStringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseFilters(query: any): {
  workspaceId?: string;
  issueId?: string | null;
  query?: string;
  limit?: number;
  offset?: number;
} {
  const workspaceId = getStringParam(query.workspace_id);
  const issueId = typeof query.issue_id === "string" ? query.issue_id.trim() || null : undefined;
  const searchQuery = getStringParam(query.query);
  const limit = Number(query.limit) || 50;
  const offset = Number(query.offset) || 0;
  return { workspaceId, issueId, query: searchQuery, limit, offset };
}

function parseCreateBody(
  body: any,
): { value: any } | { error: string } {
  if (!body.title || typeof body.title !== "string")
    return { error: "title is required" };
  if (!body.content || typeof body.content !== "string")
    return { error: "content is required" };
  if (!body.workspace_id || typeof body.workspace_id !== "string")
    return { error: "workspace_id is required" };
  return {
    value: {
      workspaceId: body.workspace_id,
      title: body.title,
      content: body.content,
      tags: Array.isArray(body.tags)
        ? body.tags.filter((t: unknown) => typeof t === "string")
        : [],
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    },
  };
}

function parseUpdateBody(body: any): any {
  const result: any = {};
  if (body.issue_id !== undefined) result.issueId = body.issue_id;
  if (typeof body.title === "string") result.title = body.title;
  if (typeof body.content === "string") result.content = body.content;
  if (Array.isArray(body.tags))
    result.tags = body.tags.filter((t: unknown) => typeof t === "string");
  if (body.metadata !== undefined)
    result.metadata = body.metadata ? JSON.stringify(body.metadata) : null;
  return result;
}
