import type express from "express";
import type { ProjectManager } from "../../project-workflow/manager";
import { logger } from "../../logger";
import { isStageStatus } from "./validation";

export function registerFeatureRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerFeatureLifecycleRoutes(router, projectManager);
  registerFeatureReadRoutes(router, projectManager);
  registerStageMutationRoutes(router, projectManager);
}

function registerFeatureLifecycleRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerFeatureCreationRoute(router, projectManager);
  registerFeatureAdvanceRoute(router, projectManager);
  registerFeatureRestartRoute(router, projectManager);
  registerFeatureCloseRoutes(router, projectManager);
}

function registerFeatureCreationRoute(router: express.Router, projectManager: ProjectManager): void {
  router.post("/projects/:projectId/features", (req, res) => {
    const { title, summary } = req.body ?? {};
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "title is required" });
      return;
    }
    try {
      const result = projectManager.createFeature(req.params.projectId, title, summary);
      logger.info("Feature creation requested", { projectId: req.params.projectId, featureId: result.feature.id });
      res.status(201).json(result);
    } catch (err: any) {
      logger.warn("Feature creation failed", { projectId: req.params.projectId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });
}

function registerFeatureAdvanceRoute(router: express.Router, projectManager: ProjectManager): void {
  router.post("/features/:featureId/advance", (req, res) => {
    try {
      logger.info("Feature advance requested", { featureId: req.params.featureId });
      res.status(201).json(projectManager.advanceFeature(req.params.featureId));
    } catch (err: any) {
      logger.warn("Feature advance failed", { featureId: req.params.featureId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });
}

function registerFeatureRestartRoute(router: express.Router, projectManager: ProjectManager): void {
  router.post("/features/:featureId/restart-development", (req, res) => {
    const { stage_id } = req.body ?? {};
    if (!stage_id || typeof stage_id !== "string") {
      res.status(400).json({ error: "stage_id is required" });
      return;
    }
    try {
      res.status(201).json(projectManager.restartFeatureDevelopment(req.params.featureId, stage_id));
    } catch (err: any) {
      logger.warn("Feature development restart failed", { featureId: req.params.featureId, stageId: stage_id, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });
}

function registerFeatureCloseRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.patch("/features/:featureId/repo-context", (req, res) => {
    const repoContext = parseFeatureRepoContext(req.body);
    if (!repoContext) {
      res.status(400).json({ error: "invalid repo context" });
      return;
    }
    try {
      res.json(projectManager.updateFeatureRepoContext(req.params.featureId, repoContext));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/features/:featureId/complete", (req, res) => {
    try {
      res.json(projectManager.completeFeature(req.params.featureId));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/features/:featureId/archive", (req, res) => {
    try {
      res.json(projectManager.archiveFeature(req.params.featureId));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
}

function parseFeatureRepoContext(body: any): { branchName?: string; worktreePath?: string; prUrl?: string } | null {
  const input = body ?? {};
  const parsed: { branchName?: string; worktreePath?: string; prUrl?: string } = {};
  const branchName = optionalString(input.branch_name);
  const worktreePath = optionalString(input.worktree_path);
  const prUrl = optionalString(input.pr_url);
  if (!branchName.valid || !worktreePath.valid || !prUrl.valid) return null;
  if (branchName.present) parsed.branchName = branchName.value;
  if (worktreePath.present) parsed.worktreePath = worktreePath.value;
  if (prUrl.present) parsed.prUrl = prUrl.value;
  return parsed;
}

function optionalString(value: unknown): { present: false; valid: true } | { present: true; valid: true; value: string } | { present: true; valid: false } {
  if (value === undefined) return { present: false, valid: true };
  if (typeof value === "string") return { present: true, valid: true, value };
  return { present: true, valid: false };
}

function registerFeatureReadRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/features/:featureId", (req, res) => {
    const feature = projectManager.getFeature(req.params.featureId);
    if (!feature) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    res.json(feature);
  });

  router.get("/features/:featureId/stages", (req, res) => {
    const feature = projectManager.getFeature(req.params.featureId);
    if (!feature) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    res.json(feature.stages);
  });

  router.get("/features/:featureId/conversations", (req, res) => {
    res.json(projectManager.listFeatureConversations(req.params.featureId));
  });
}

function registerStageMutationRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/stages/:stageId", (req, res) => {
    const stage = projectManager.getStage(req.params.stageId);
    if (!stage) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }
    res.json(stage);
  });

  router.patch("/stages/:stageId", (req, res) => {
    const updates = parseStageUpdates(req.body);
    if (!updates) {
      res.status(400).json({ error: "invalid stage status" });
      return;
    }
    try {
      projectManager.updateStage(req.params.stageId, updates);
      const stage = projectManager.getStage(req.params.stageId);
      if (!stage) { res.status(404).json({ error: "Stage not found" }); return; }
      res.json(stage);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/stages/:stageId/conversations", (req, res) => {
    res.json(projectManager.listStageConversations(req.params.stageId));
  });
}

function parseStageUpdates(body: any): any | null {
  if (body?.status && !isStageStatus(body.status)) return null;
  const updates: any = {};
  for (const key of ["status", "entered_at", "left_at"]) {
    if (body?.[key] !== undefined) updates[key] = body[key];
  }
  for (const key of ["output_artifacts", "input_artifacts"]) {
    if (Array.isArray(body?.[key])) updates[key] = body[key];
  }
  return updates;
}
