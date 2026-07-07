import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { SearchCoordinatorPort } from "@domain/memory-search/port";
import type { ContentType } from "@domain/memory-search/model";

/**
 * Memory Search MCP Server。
 * 提供跨域统一搜索工具。
 */
export function createMemorySearchServer(coordinator: SearchCoordinatorPort): MCPServerConfig {
  return {
    name: "snail-memory-search",
    version: "1.0.0",
    tools: [
      createSearchMemoryTool(coordinator),
    ],
  };
}

function createSearchMemoryTool(coordinator: SearchCoordinatorPort): MCPTool {
  return {
    name: "search_memory",
    description: "跨域统一搜索：同时搜索知识库、消息历史、Feature 文档、演进项",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        content_types: {
          type: "array",
          items: { type: "string", enum: ["knowledge", "message", "feature_doc", "evolution"] },
          description: "限定搜索域（可选，默认全部）",
        },
        top_n: { type: "number", description: "返回结果数（默认 20）" },
        workspace_path: { type: "string", description: "工作区路径（可选）" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "标签过滤（OR 语义）",
        },
        after: { type: "string", description: "时间范围起点（ISO 格式，可选）" },
        before: { type: "string", description: "时间范围终点（ISO 格式，可选）" },
      },
      required: ["query"],
    },
    handler: async (params) => {
      const query = String(params.query ?? "");
      const contentTypes = Array.isArray(params.content_types)
        ? params.content_types.filter((ct): ct is ContentType =>
            typeof ct === "string" && ["knowledge", "message", "feature_doc", "evolution"].includes(ct))
        : undefined;

      const results = coordinator.search(query, {
        content_types: contentTypes,
        top_n: typeof params.top_n === "number" ? params.top_n : undefined,
        workspace_path: typeof params.workspace_path === "string" ? params.workspace_path : undefined,
        tags: Array.isArray(params.tags)
          ? params.tags.filter((t): t is string => typeof t === "string")
          : undefined,
        time_range: {
          after: typeof params.after === "string" ? params.after : undefined,
          before: typeof params.before === "string" ? params.before : undefined,
        },
      });

      return {
        total: results.length,
        items: results.map((r) => ({
          content_type: r.content_type,
          id: r.id,
          title: r.title,
          snippet: r.snippet,
          score: r.score,
          source: r.source,
          metadata: r.metadata,
        })),
      };
    },
  };
}
