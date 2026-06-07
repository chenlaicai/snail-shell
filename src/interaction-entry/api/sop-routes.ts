import type express from "express";
import type { WorkspaceManager } from "../../workspace-workflow/manager";

export function registerSopRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.get("/sops", (req, res) => {
    const source = req.query.source as "platform" | "workspace" | undefined;
    res.json(workspaceManager.listSops(source === "platform" || source === "workspace" ? source : undefined));
  });

  router.get("/sops/:sopId", (req, res) => {
    const sop = workspaceManager.getSop(req.params.sopId);
    if (!sop) { res.status(404).json({ error: "SOP not found" }); return; }
    const stageDefinitions = workspaceManager.listSopStageDefinitionsWithRoles(sop.id);
    res.json({ ...sop, stage_definitions: stageDefinitions, transitions: workspaceManager.getSopTransitions(sop.id) });
  });

  router.post("/sops", (req, res) => {
    const { key, name, description, first_stage, shared_handbook, stage_definitions, transitions } = req.body ?? {};
    if (!key || typeof key !== "string") { res.status(400).json({ error: "key is required" }); return; }
    if (!name || typeof name !== "string") { res.status(400).json({ error: "name is required" }); return; }
    if (!Array.isArray(stage_definitions) || stage_definitions.length === 0) { res.status(400).json({ error: "stage_definitions is required and must not be empty" }); return; }
    try {
      const sop = workspaceManager.createPlatformSop({ key, name, description, first_stage, shared_handbook, stage_definitions, transitions });
      res.status(201).json(sop);
    } catch (err: any) {
      res.status(err.message.includes("already exists") ? 409 : 400).json({ error: err.message });
    }
  });

  router.patch("/sops/:sopId", (req, res) => {
    const { name, description, first_stage, shared_handbook, stage_definitions, transitions } = req.body ?? {};
    if (stage_definitions !== undefined && (!Array.isArray(stage_definitions) || stage_definitions.length === 0)) {
      res.status(400).json({ error: "stage_definitions must be a non-empty array" }); return;
    }
    try {
      const sop = workspaceManager.updatePlatformSop(req.params.sopId, { name, description, first_stage, shared_handbook, stage_definitions, transitions });
      res.json(sop);
    } catch (err: any) {
      res.status(err.message.includes("not found") ? 404 : 400).json({ error: err.message });
    }
  });

  router.delete("/sops/:sopId", (req, res) => {
    try {
      const affectedWorkspaces = workspaceManager.deletePlatformSop(req.params.sopId);
      res.status(200).json({ affected_workspaces: affectedWorkspaces });
    } catch (err: any) {
      res.status(err.message.includes("not found") ? 404 : 400).json({ error: err.message });
    }
  });
}
