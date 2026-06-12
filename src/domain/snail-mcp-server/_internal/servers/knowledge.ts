import type { MCPServerConfig } from "@domain/snail-mcp-server/model";
import type { KnowledgePort } from "@domain/knowledge/port";

/**
 * Knowledge MCP Server。
 * 提供知识库查询、创建、删除工具。
 */
export function createKnowledgeServer(knowledge: KnowledgePort): MCPServerConfig {
  return {
    name: "snail-knowledge",
    version: "1.0.0",
    tools: [
      {
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
          const workspace = params.workspace_path ? { path: params.workspace_path as string, summary: null } : undefined;
          const entries = workspace
            ? knowledge.findByWorkspace(workspace)
            : knowledge.list();

          const query = (params.query as string).toLowerCase();
          const filtered = entries.filter(
            e => e.title.toLowerCase().includes(query) || e.content.toLowerCase().includes(query)
          );

          return { items: filtered };
        },
      },
      {
        name: "list_knowledge",
        description: "列出知识库条目",
        inputSchema: {
          type: "object",
          properties: {
            workspace_path: { type: "string", description: "工作区路径（可选）" },
          },
        },
        handler: async (params) => {
          const workspace = params.workspace_path ? { path: params.workspace_path as string, summary: null } : undefined;
          const items = workspace
            ? knowledge.findByWorkspace(workspace)
            : knowledge.list();

          return { items };
        },
      },
      {
        name: "add_knowledge",
        description: "创建知识库条目",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "条目 ID" },
            title: { type: "string", description: "标题" },
            tags: { type: "array", items: { type: "string" }, description: "标签" },
            content: { type: "string", description: "内容" },
            scope: { type: "string", enum: ["platform", "workspace"], description: "作用域" },
            workspace_path: { type: "string", description: "工作区路径（scope=workspace 时必填）" },
          },
          required: ["id", "title", "content", "scope"],
        },
        handler: async (params) => {
          const entry = knowledge.add({
            id: params.id as string,
            title: params.title as string,
            tags: params.tags as string[] | undefined,
            content: params.content as string,
            scope: params.scope as "platform" | "workspace",
            workspace: params.workspace_path ? { path: params.workspace_path as string, summary: null } : undefined,
          });

          return { entry };
        },
      },
      {
        name: "remove_knowledge",
        description: "删除知识库条目",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "条目 ID" },
            scope: { type: "string", enum: ["platform", "workspace"], description: "作用域" },
            workspace_path: { type: "string", description: "工作区路径（scope=workspace 时必填）" },
          },
          required: ["id", "scope"],
        },
        handler: async (params) => {
          knowledge.remove({
            id: params.id as string,
            scope: params.scope as "platform" | "workspace",
            workspace: params.workspace_path ? { path: params.workspace_path as string, summary: null } : undefined,
          });
          return { ok: true };
        },
      },
    ],
  };
}
