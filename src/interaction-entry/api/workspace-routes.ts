import type express from "express";
import path from "path";
import type { WorkspaceManager } from "../../workspace-workflow/manager";
import { logger } from "../../logger";
import { loadWorkspaceConfigOnly } from "../../workspace-workflow/snail-loader";
import { registerIssueRoutes } from "./issue-routes";
import { registerSopRoutes } from "./sop-routes";

/** 校验 workspace_root 必须为绝对路径且不含 .. 遍历 */
function validateWorkspaceRoot(root: string): string | null {
  if (!path.isAbsolute(root)) return "workspace_root must be an absolute path";
  const normalized = path.normalize(root);
  if (normalized.includes("..")) return "workspace_root must not contain path traversal";
  return null;
}

export function registerWorkspaceRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  registerIssueRoutes(router, workspaceManager);
  registerSnailRoutes(router, workspaceManager);

  router.get("/workspaces", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(workspaceManager.listWorkspaces(limit, offset));
  });

  router.post("/workspaces", handleCreateWorkspace(workspaceManager));

  router.get("/workspaces/:workspaceId", (req, res) => {
    const workspace = workspaceManager.getWorkspace(req.params.workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    res.json(workspace);
  });

  router.get("/workspaces/:workspaceId/stages", (req, res) => {
    res.json(workspaceManager.listStages(req.params.workspaceId));
  });

  router.get("/workspaces/:workspaceId/issues", (req, res) => {
    res.json(workspaceManager.listIssues(req.params.workspaceId));
  });

  router.get("/workspaces/:workspaceId/conversations", (req, res) => {
    res.json(workspaceManager.listWorkspaceConversations(req.params.workspaceId));
  });

  registerSopRoutes(router, workspaceManager);
}

function handleCreateWorkspace(workspaceManager: WorkspaceManager): express.RequestHandler {
  return (req, res) => {
    const { name, summary, workspace_root, sop_id, role_snail_mapping, load_from_snail } = req.body ?? {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    if (workspace_root && typeof workspace_root === "string") {
      const pathError = validateWorkspaceRoot(workspace_root);
      if (pathError) { res.status(400).json({ error: pathError }); return; }
    }

    if (!sop_id || typeof sop_id !== "string") {
      res.status(400).json({ error: "sop_id is required" });
      return;
    }

    // 如果从 .snail 加载，role_snail_mapping 可以为空
    if (!load_from_snail) {
      if (!sop_id || typeof sop_id !== "string") {
        res.status(400).json({ error: "sop_id is required" });
        return;
      }
    }

    try {
      const result = workspaceManager.createWorkspace(name, {
        summary,
        workspaceRoot: workspace_root,
        sopId: sop_id,
        roleSnailMapping: role_snail_mapping || {},
        loadFromSnail: Boolean(load_from_snail),
      });
      logger.debug("Workspace created", { workspaceId: result.workspace.id, issueId: result.issue.id, stageId: result.stage.id, conversationId: result.conversation.id, loadFromSnail: Boolean(load_from_snail) });
      res.status(201).json(result);
    } catch (err: any) {
      logger.warn("Workspace creation failed", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  };
}

function registerSnailRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.post("/workspaces/detect-snail", (req, res) => {
    const { workspace_root } = req.body ?? {};
    if (!workspace_root || typeof workspace_root !== "string") {
      res.status(400).json({ error: "workspace_root is required" });
      return;
    }
    const pathError = validateWorkspaceRoot(workspace_root);
    if (pathError) { res.status(400).json({ error: pathError }); return; }
    try {
      const hasSnail = workspaceManager.hasSnailConfig(workspace_root);
      let config = null;
      if (hasSnail) {
        config = loadWorkspaceConfigOnly(workspace_root);
      }
      res.json({ has_snail: hasSnail, config });
    } catch (err: any) {
      logger.warn("Failed to detect .snail directory", { error: err.message, workspaceRoot: workspace_root });
      /** 不向客户端暴露服务器端文件路径，仅返回错误类型 */
      res.status(400).json({ error: "Failed to read .snail configuration" });
    }
  });

  router.post("/workspaces/:workspaceId/load-snail", (req, res) => {
    const workspace = workspaceManager.getWorkspace(req.params.workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    try {
      const result = workspaceManager.loadWorkspaceFromSnail(req.params.workspaceId, workspace.workspace_root);
      res.json({ success: result, message: "Workspace config loaded from .snail directory" });
    } catch (err: any) {
      logger.warn("Failed to load workspace from .snail", { error: err.message, workspaceId: req.params.workspaceId });
      /** 不向客户端暴露服务器端文件路径 */
      res.status(400).json({ error: "Failed to load .snail configuration" });
    }
  });
}
