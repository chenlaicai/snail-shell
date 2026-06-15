import { Hono } from "hono";
import type { EvolutionPort } from "@domain/evolution/port";

interface EvolutionRoutesDeps {
  evolution: EvolutionPort;
}

export function createEvolutionRoutes(deps: EvolutionRoutesDeps) {
  const app = new Hono();

  app.get("/api/evolution/items", (c) => {
    const workspaceId = c.req.query("workspace_id");
    const issueId = c.req.query("issue_id");
    const query = c.req.query("query") ?? "";
    const filters = { workspace_id: workspaceId, issue_id: issueId } as const;
    const items = query ? deps.evolution.search(query, filters) : deps.evolution.list(filters);
    return c.json(items);
  });

  app.get("/api/evolution/items/:itemId", (c) => {
    const item = deps.evolution.findById(c.req.param("itemId"));
    if (!item) return c.json(null, 404);
    return c.json(item);
  });

  return app;
}
