import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { KnowledgePort } from "@domain/knowledge/port";
import { Scope } from "@domain/workspace/model";

/**
 * Knowledge MCP Server。
 * 提供知识库查询、创建、删除工具。
 */
export function createKnowledgeServer(knowledge: KnowledgePort): MCPServerConfig {
  return {
    name: "snail-knowledge",
    version: "1.0.0",
    tools: [
      createSearchKnowledgeTool(knowledge),
      createListKnowledgeTool(knowledge),
      createAddKnowledgeTool(knowledge),
      createRemoveKnowledgeTool(knowledge),
    ],
  };
}

function createSearchKnowledgeTool(knowledge: KnowledgePort): MCPTool {
  return {
    name: "search_knowledge",
    description: "搜索知识库条目",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        workspace_path: { type: "string", description: "工作区路径（可选）" },
      },
      required: ["query"],
    },
    handler: async (params) => {
      const entries = listEntries(knowledge, params.workspace_path);
      const query = String(params.query ?? "").toLowerCase();
      return { items: entries.filter(e => e.title.toLowerCase().includes(query) || e.content.toLowerCase().includes(query)) };
    },
  };
}

function createListKnowledgeTool(knowledge: KnowledgePort): MCPTool {
  return {
    name: "list_knowledge",
    description: "列出知识库条目",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: { type: "string", description: "工作区路径（可选）" },
      },
    },
    handler: async (params) => ({ items: listEntries(knowledge, params.workspace_path) }),
  };
}

function createAddKnowledgeTool(knowledge: KnowledgePort): MCPTool {
  return {
    name: "add_knowledge",
    description: "创建知识库条目",
    inputSchema: knowledgeMutationSchema(["id", "title", "content", "scope"]),
    handler: async (params) => ({
      entry: knowledge.add({
        id: String(params.id),
        title: String(params.title),
        tags: Array.isArray(params.tags) ? params.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
        content: String(params.content),
        scope: toScope(params.scope),
        workspace: toWorkspace(params.workspace_path),
      }),
    }),
  };
}

function createRemoveKnowledgeTool(knowledge: KnowledgePort): MCPTool {
  return {
    name: "remove_knowledge",
    description: "删除知识库条目",
    inputSchema: knowledgeMutationSchema(["id", "scope"]),
    handler: async (params) => {
      knowledge.remove({ id: String(params.id), scope: toScope(params.scope), workspace: toWorkspace(params.workspace_path) });
      return { ok: true };
    },
  };
}

function knowledgeMutationSchema(required: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      id: { type: "string", description: "条目 ID" },
      title: { type: "string", description: "标题" },
      tags: { type: "array", items: { type: "string" }, description: "标签" },
      content: { type: "string", description: "内容" },
      scope: { type: "string", enum: ["platform", "workspace"], description: "作用域" },
      workspace_path: { type: "string", description: "工作区路径（scope=workspace 时必填）" },
    },
    required,
  };
}

function listEntries(knowledge: KnowledgePort, workspacePath: unknown) {
  const workspace = toWorkspace(workspacePath);
  return workspace ? knowledge.findByWorkspace(workspace) : knowledge.list();
}

function toWorkspace(workspacePath: unknown) {
  return typeof workspacePath === "string" && workspacePath ? { path: workspacePath, summary: null } : undefined;
}

function toScope(scope: unknown): Scope {
  return scope === Scope.Workspace ? Scope.Workspace : Scope.Platform;
}
