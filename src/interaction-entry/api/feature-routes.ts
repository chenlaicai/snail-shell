import type express from "express";
import type { WorkspaceManager } from "../../workspace-workflow/manager";
import { logger } from "../../logger";
import { isStageStatus } from "./validation";

export function registerFeatureRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  registerFeatureLifecycleRoutes(router, workspaceManager);
  registerFeatureReadRoutes(router, workspaceManager);
  registerStageMutationRoutes(router, workspaceManager);
}

function registerFeatureLifecycleRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  registerFeatureCreationRoute(router, workspaceManager);
  registerFeatureAdvanceRoute(router, workspaceManager);
  registerFeatureBounceRoute(router, workspaceManager);
  registerFeatureCloseRoutes(router, workspaceManager);
}

function registerFeatureCreationRoute(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.post("/workspaces/:workspaceId/features", (req, res) => {
    const { title, summary, adopted_sop_id } = req.body ?? {};
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "title is required" });
      return;
    }
    try {
      const result = workspaceManager.createFeature(req.params.workspaceId, title, summary, adopted_sop_id);
      logger.info("Feature creation requested", { workspaceId: req.params.workspaceId, featureId: result.feature.id });
      res.status(201).json(result);
    } catch (err: any) {
      logger.warn("Feature creation failed", { workspaceId: req.params.workspaceId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });
}

function registerFeatureAdvanceRoute(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.post("/features/:featureId/advance", (req, res) => {
    try {
      logger.info("Feature advance requested", { featureId: req.params.featureId });
      res.status(201).json(workspaceManager.advanceFeature(req.params.featureId));
    } catch (err: any) {
      logger.warn("Feature advance failed", { featureId: req.params.featureId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });
}

function registerFeatureBounceRoute(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.post("/features/:featureId/bounce-stage", (req, res) => {
    const { stage_id } = req.body ?? {};
    if (!stage_id || typeof stage_id !== "string") {
      res.status(400).json({ error: "stage_id is required" });
      return;
    }
    try {
      res.status(201).json(workspaceManager.bounceFeatureStage(req.params.featureId, stage_id));
    } catch (err: any) {
      logger.warn("Feature stage bounce failed", { featureId: req.params.featureId, stageId: stage_id, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });
}

function registerFeatureCloseRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.patch("/features/:featureId/task-anchor", (req, res) => {
    const { task_anchor } = req.body ?? {};
    if (typeof task_anchor !== "string") {
      res.status(400).json({ error: "task_anchor must be a string" });
      return;
    }
    try {
      res.json(workspaceManager.setFeatureTaskAnchor(req.params.featureId, task_anchor));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/features/:featureId/role-snail", (req, res) => {
    const { stage_id, role_name, snail_template_id } = req.body ?? {};
    if (typeof stage_id !== "string" || typeof role_name !== "string" || typeof snail_template_id !== "string") {
      res.status(400).json({ error: "stage_id, role_name, and snail_template_id are required" });
      return;
    }
    try {
      res.json(workspaceManager.setFeatureRoleSnail(req.params.featureId, stage_id, role_name, snail_template_id));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/features/:featureId/complete", (req, res) => {
    try {
      res.json(workspaceManager.completeFeature(req.params.featureId));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/features/:featureId/archive", (req, res) => {
    try {
      res.json(workspaceManager.archiveFeature(req.params.featureId));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
}

function registerFeatureReadRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.get("/features/:featureId", (req, res) => {
    const feature = workspaceManager.getFeature(req.params.featureId);
    if (!feature) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    res.json(feature);
  });

  router.get("/features/:featureId/stages", (req, res) => {
    const feature = workspaceManager.getFeature(req.params.featureId);
    if (!feature) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    res.json(feature.stages);
  });

  router.get("/features/:featureId/conversations", (req, res) => {
    res.json(workspaceManager.listFeatureConversations(req.params.featureId));
  });
}

function registerStageMutationRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.get("/stages/:stageId", (req, res) => {
    const stage = workspaceManager.getStage(req.params.stageId);
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
      workspaceManager.updateStage(req.params.stageId, updates);
      const stage = workspaceManager.getStage(req.params.stageId);
      if (!stage) { res.status(404).json({ error: "Stage not found" }); return; }
      res.json(stage);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/stages/:stageId/conversations", (req, res) => {
    res.json(workspaceManager.listStageConversations(req.params.stageId));
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
function parseOutputArtifacts(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
