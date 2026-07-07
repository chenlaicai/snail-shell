import { Hono } from "hono";
import type { EvolutionPort } from "@domain/evolution/port";
import type { EvolutionAppPort } from "@app/evolution/port";

interface EvolutionRoutesDeps {
  evolution: EvolutionPort;
  evolutionApp: EvolutionAppPort;
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

  app.post("/api/evolution/items/:itemId/create-issue", async (c) => {
    const itemId = c.req.param("itemId");
    try {
      const item = await deps.evolutionApp.createIssueFromItem(itemId);
      return c.json(item);
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post("/api/evolution/items/:itemId/close", async (c) => {
    const itemId = c.req.param("itemId");
    let body: { result?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      /** body 可选，解析失败时使用空对象 */
    }
    try {
      const item = await deps.evolutionApp.closeItem(itemId, body.result);
      return c.json(item);
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  return app;
}
