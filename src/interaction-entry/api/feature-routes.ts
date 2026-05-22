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
  router.patch("/features/:featureId/repo-context", (_req, res) => {
    res.status(410).json({ error: "repo-context endpoint is deprecated: use PATCH /stages/:stageId with output_artifacts instead" });
  });

  router.patch("/features/:featureId/task-anchor", (req, res) => {
    const { task_anchor } = req.body ?? {};
    if (typeof task_anchor !== "string") {
      res.status(400).json({ error: "task_anchor must be a string" });
      return;
    }
    try {
      res.json(projectManager.setFeatureTaskAnchor(req.params.featureId, task_anchor));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/features/:featureId/role-snail", (req, res) => {
    const { stage_type, role_name, snail_template_id } = req.body ?? {};
    if (typeof stage_type !== "string" || typeof role_name !== "string" || typeof snail_template_id !== "string") {
      res.status(400).json({ error: "stage_type, role_name, and snail_template_id are required" });
      return;
    }
    try {
      res.json(projectManager.setFeatureRoleSnail(req.params.featureId, stage_type, role_name, snail_template_id));
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
  const artifacts = parseOutputArtifacts(body?.output_artifacts);
  if (artifacts) updates.output_artifacts = artifacts;
  return updates;
}

/** Validate and normalize output_artifacts to Record<string,string>, or null if absent/invalid. */
function parseOutputArtifacts(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    record[k] = String(v);
  }
  return record;
}
