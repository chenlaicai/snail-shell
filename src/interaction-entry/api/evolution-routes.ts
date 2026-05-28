import type express from "express";
import type { ProjectManager } from "../../project-workflow/manager";
import type { EvolutionItemStatus } from "../../shared/evolution-types";

const STATUSES = new Set(["pending", "governing", "resolved", "closed"]);

export function registerEvolutionRoutes(
  router: express.Router,
  projectManager: ProjectManager,
): void {
  registerEvolutionReadRoutes(router, projectManager);
  registerEvolutionMutationRoutes(router, projectManager);
}

function registerEvolutionReadRoutes(
  router: express.Router,
  projectManager: ProjectManager,
): void {
  router.get("/evolution/items", (req, res) => {
    res.json(projectManager.listEvolutionItems(parseFilters(req.query)));
  });

  router.get("/projects/:projectId/evolution/items", (req, res) => {
    res.json(
      projectManager.listEvolutionItems({
        ...parseFilters(req.query),
        projectId: req.params.projectId,
      }),
    );
  });

  router.get("/evolution/items/:itemId", (req, res) => {
    const item = projectManager.getEvolutionItem(req.params.itemId);
    if (!item) {
      res.status(404).json({ error: "Evolution item not found" });
      return;
    }
    res.json(item);
  });
}

function registerEvolutionMutationRoutes(
  router: express.Router,
  projectManager: ProjectManager,
): void {
  router.post("/evolution/items", (req, res) => {
    const parsed = parseCreateBody(req.body ?? {});
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.status(201).json(projectManager.createEvolutionItem(parsed.value));
  });

  router.patch("/evolution/items/:itemId", (req, res) => {
    try {
      const parsed = parseUpdateBody(req.body ?? {});
      res.json(
        projectManager.updateEvolutionItem(req.params.itemId, parsed),
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
  projectId?: string;
  featureId?: string | null;
  status?: EvolutionItemStatus;
  query?: string;
  limit?: number;
  offset?: number;
} {
  const projectId = getStringParam(query.project_id);
  const featureId = typeof query.feature_id === "string" ? query.feature_id.trim() || null : undefined;
  const status = typeof query.status === "string" && STATUSES.has(query.status) ? (query.status as EvolutionItemStatus) : undefined;
  const searchQuery = getStringParam(query.query);
  const limit = Number(query.limit) || 50;
  const offset = Number(query.offset) || 0;
  return { projectId, featureId, status, query: searchQuery, limit, offset };
}

function parseCreateBody(
  body: any,
): { value: any } | { error: string } {
  if (!body.title || typeof body.title !== "string")
    return { error: "title is required" };
  if (!body.content || typeof body.content !== "string")
    return { error: "content is required" };
  if (!body.project_id || typeof body.project_id !== "string")
    return { error: "project_id is required" };
  return {
    value: {
      projectId: body.project_id,
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
  if (body.feature_id !== undefined) result.featureId = body.feature_id;
  if (typeof body.title === "string") result.title = body.title;
  if (typeof body.content === "string") result.content = body.content;
  if (Array.isArray(body.tags))
    result.tags = body.tags.filter((t: unknown) => typeof t === "string");
  if (typeof body.status === "string" && STATUSES.has(body.status))
    result.status = body.status;
  if (body.disposition_note !== undefined)
    result.dispositionNote = body.disposition_note;
  if (body.metadata !== undefined)
    result.metadata = body.metadata ? JSON.stringify(body.metadata) : null;
  return result;
}
