import type express from "express";
import type { SnailDen } from "../../snail-den";
import { listPrompts } from "../../prompt-center";
import { listSkills } from "../../skill-center";
import { collectActiveMcpServers, getBuiltinMcpNames } from "../../mcp/registry";

export function registerMetaRoutes(router: express.Router, snailDen: SnailDen): void {
  router.get("/meta/prompts", (_req, res) => {
    res.json(listPrompts().map((prompt) => ({
      ...prompt,
      filePath: prompt.filePath.replace(`${process.cwd()}/`, ""),
    })));
  });

  router.get("/meta/skills", (_req, res) => {
    res.json(listSkills().map((skill) => ({
      ...skill,
      filePath: skill.filePath.replace(`${process.cwd()}/`, ""),
    })));
  });

  router.get("/snail-den", (_req, res) => {
    res.json(snailDen.listTemplates());
  });

  /** 读取所有已配置的 MCP server（平台 + workspace 合并），供前端 MCPs 目录展示。 */
  router.get("/meta/mcps", (req, res) => {
    try {
      const workspaceRoot = typeof req.query.workspace_root === "string" ? req.query.workspace_root : undefined;
      const allServers = collectActiveMcpServers(workspaceRoot);
      const builtinNames = getBuiltinMcpNames();
      const all = allServers.map((s) => ({ ...s, builtin: builtinNames.has(s.name) }));
      res.json(all);
    } catch {
      res.json([]);
    }
  });
}
