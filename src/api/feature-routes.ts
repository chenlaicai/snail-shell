import type express from "express";
import type { ProjectManager } from "../project/manager";
import { logger } from "../logger";
import { isStageStatus } from "./validation";

export function registerFeatureRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerFeatureLifecycleRoutes(router, projectManager);
  registerFeatureReadRoutes(router, projectManager);
  registerStageMutationRoutes(router, projectManager);
}

function registerFeatureLifecycleRoutes(router: express.Router, projectManager: ProjectManager): void {
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

  router.post("/features/:featureId/advance", (req, res) => {
    try {
      logger.info("Feature advance requested", { featureId: req.params.featureId });
      res.status(201).json(projectManager.advanceFeature(req.params.featureId));
    } catch (err: any) {
      logger.warn("Feature advance failed", { featureId: req.params.featureId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

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

  router.post("/features/:featureId/complete", (req, res) => {
    try {
      res.json(projectManager.completeFeature(req.params.featureId));
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

  router.get("/features/:featureId/artifacts", (req, res) => {
    res.json(projectManager.listFeatureArtifacts(req.params.featureId));
  });
}

function registerStageMutationRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.patch("/stages/:stageId", (req, res) => {
    const updates = parseStageUpdates(req.body);
    if (!updates) {
      res.status(400).json({ error: "invalid stage status" });
      return;
    }
    try {
      res.json(projectManager.updateStage(req.params.stageId, updates));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/stages/:stageId/conversations", (req, res) => {
    res.json(projectManager.listStageConversations(req.params.stageId));
  });
}

function parseStageUpdates(body: any): any | null {
  const updates: any = {};
  if (body?.status) {
    if (!isStageStatus(body.status)) return null;
    updates.status = body.status;
  }
  if (Array.isArray(body?.formal_artifacts)) updates.formal_artifacts = body.formal_artifacts;
  if (body?.entered_at !== undefined) updates.entered_at = body.entered_at;
  if (body?.left_at !== undefined) updates.left_at = body.left_at;
  return updates;
}
