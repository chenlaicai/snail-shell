import type express from "express";
import type { WorkspaceManager } from "../../workspace-workflow/manager";
import { logger } from "../../logger";
import { isStageStatus } from "./validation";

export function registerIssueRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  registerIssueLifecycleRoutes(router, workspaceManager);
  registerIssueReadRoutes(router, workspaceManager);
  registerStageMutationRoutes(router, workspaceManager);
}

function registerIssueLifecycleRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  registerIssueCreationRoute(router, workspaceManager);
  registerIssueAdvanceRoute(router, workspaceManager);
  registerIssueBounceRoute(router, workspaceManager);
  registerIssueCloseRoutes(router, workspaceManager);
}

function registerIssueCreationRoute(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.post("/workspaces/:workspaceId/issues", (req, res) => {
    const { title, summary, adopted_sop_id } = req.body ?? {};
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "title is required" });
      return;
    }
    try {
      const result = workspaceManager.createIssue(req.params.workspaceId, title, summary, adopted_sop_id);
      logger.info("Issue creation requested", { workspaceId: req.params.workspaceId, issueId: result.issue.id });
      res.status(201).json(result);
    } catch (err: any) {
      logger.warn("Issue creation failed", { workspaceId: req.params.workspaceId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });
}

function registerIssueAdvanceRoute(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.post("/issues/:issueId/advance", (req, res) => {
    try {
      const { target_stage_key } = req.body ?? {};
      logger.info("Issue advance requested", { issueId: req.params.issueId, targetStageKey: target_stage_key ?? null });
      res.status(201).json(workspaceManager.advanceIssue(req.params.issueId, target_stage_key));
    } catch (err: any) {
      logger.warn("Issue advance failed", { issueId: req.params.issueId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });
}

function registerIssueBounceRoute(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.post("/issues/:issueId/bounce-stage", (req, res) => {
    const { target_stage_key } = req.body ?? {};
    if (!target_stage_key || typeof target_stage_key !== "string") {
      res.status(400).json({ error: "target_stage_key is required" });
      return;
    }
    try {
      res.status(201).json(workspaceManager.transitionIssueStage(req.params.issueId, target_stage_key));
    } catch (err: any) {
      logger.warn("Issue stage transition failed", { issueId: req.params.issueId, targetStageKey: target_stage_key, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });
}

function registerIssueCloseRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.patch("/issues/:issueId/task-anchor", (req, res) => {
    const { task_anchor } = req.body ?? {};
    if (typeof task_anchor !== "string") {
      res.status(400).json({ error: "task_anchor must be a string" });
      return;
    }
    try {
      res.json(workspaceManager.setIssueTaskAnchor(req.params.issueId, task_anchor));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/issues/:issueId/role-snail", (req, res) => {
    const { stage_id, role_name, snail_template_id } = req.body ?? {};
    if (typeof stage_id !== "string" || typeof role_name !== "string" || typeof snail_template_id !== "string") {
      res.status(400).json({ error: "stage_id, role_name, and snail_template_id are required" });
      return;
    }
    try {
      res.json(workspaceManager.setIssueRoleSnail(req.params.issueId, stage_id, role_name, snail_template_id));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/issues/:issueId/complete", (req, res) => {
    try {
      res.json(workspaceManager.completeIssue(req.params.issueId));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/issues/:issueId/archive", (req, res) => {
    try {
      res.json(workspaceManager.archiveIssue(req.params.issueId));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
}

function registerIssueReadRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.get("/issues/:issueId", (req, res) => {
    const issue = workspaceManager.getIssue(req.params.issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json(issue);
  });

  router.get("/issues/:issueId/stages", (req, res) => {
    const issue = workspaceManager.getIssue(req.params.issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json(issue.stages);
  });

  router.get("/issues/:issueId/conversations", (req, res) => {
    res.json(workspaceManager.listIssueConversations(req.params.issueId));
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

/** Validate and normalize output_artifacts to Record<string,unknown>, or null if absent/invalid. */
function parseOutputArtifacts(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
