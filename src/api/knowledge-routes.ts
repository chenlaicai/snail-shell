import type express from "express";
import type { ProjectManager } from "../project/manager";
import { isKnowledgeProposalDecision } from "./validation";

export function registerKnowledgeRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/knowledge/dashboard", (req, res) => {
    res.json(projectManager.getKnowledgeDashboard({
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      health: typeof req.query.health === "string" ? req.query.health : undefined,
      authority: typeof req.query.authority === "string" ? req.query.authority : undefined,
      scope: typeof req.query.scope === "string" ? req.query.scope : undefined,
      knowledge_type: typeof req.query.knowledge_type === "string" ? req.query.knowledge_type : undefined,
      project_id: typeof req.query.project_id === "string" ? req.query.project_id : undefined,
    }));
  });

  router.get("/projects/:projectId/knowledge-entries", (req, res) => {
    res.json(projectManager.listProjectKnowledgeEntries(req.params.projectId));
  });

  router.post("/knowledge/proposals/bulk", (req, res) => {
    const { proposal_ids, status } = req.body ?? {};
    if (!Array.isArray(proposal_ids) || proposal_ids.length === 0) {
      res.status(400).json({ error: "proposal_ids is required" });
      return;
    }
    if (!status || typeof status !== "string" || !isKnowledgeProposalDecision(status)) {
      res.status(400).json({ error: "status must be a valid proposal decision" });
      return;
    }
    try {
      res.json(projectManager.bulkUpdateKnowledgeProposals(proposal_ids, status));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/knowledge/entries/bulk/archive", (req, res) => {
    const { entry_ids } = req.body ?? {};
    if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
      res.status(400).json({ error: "entry_ids is required" });
      return;
    }
    try {
      res.json(projectManager.bulkArchiveKnowledgeEntries(entry_ids));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });
}
