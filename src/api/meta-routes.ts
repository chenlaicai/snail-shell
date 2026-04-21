import type express from "express";
import { deleteProjectTemplate, getProjectTemplate, loadArtifactDefinitions, loadProjectTemplates, loadStageDefinitions, saveProjectTemplate } from "../meta";

export function registerMetaRoutes(router: express.Router): void {
  router.get("/meta/stages", (_req, res) => {
    res.json(loadStageDefinitions());
  });

  router.get("/meta/artifacts", (_req, res) => {
    res.json(loadArtifactDefinitions());
  });

  router.get("/meta/project-templates", (_req, res) => {
    res.json(loadProjectTemplates());
  });

  router.post("/meta/project-templates", (req, res) => {
    const { template_key, template } = req.body ?? {};
    if (!template_key || typeof template_key !== "string") {
      res.status(400).json({ error: "template_key is required" });
      return;
    }
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      res.status(400).json({ error: "template is required" });
      return;
    }
    try {
      const templates = saveProjectTemplate(template_key, template);
      res.status(201).json({ template_key, templates });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete("/meta/project-templates/:templateKey", (req, res) => {
    try {
      const templates = deleteProjectTemplate(req.params.templateKey);
      res.json({ template_key: req.params.templateKey, templates });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/meta/project-templates/:templateKey", (req, res) => {
    const template = getProjectTemplate(req.params.templateKey);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json({ template_key: req.params.templateKey, template });
  });
}
