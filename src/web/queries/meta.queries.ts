import { queryOptions } from "@tanstack/react-query";
import { api, ApiError } from "../services/api-client";
import { queryKeys } from "./keys";

/** MCP Server 列表项（来自 /mcp 端点） */
type McpServerListItem = { name: string; version: string; endpoint: string; tools: string[] };
/** MCP Server 列表响应 */
type McpServerListResponse = { servers: McpServerListItem[] };
/** MCP Server 详情（来自 /mcp/:serverName 端点） */
type McpServerDetail = {
  name: string;
  version: string;
  endpoint: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
};

export const metaQueries = {
  prompts: () =>
    queryOptions({
      queryKey: queryKeys.meta.prompts,
      queryFn: () => api("GET /api/meta/prompts"),
    }),

  skills: () =>
    queryOptions({
      queryKey: queryKeys.meta.skills,
      queryFn: () => api("GET /api/meta/skills"),
    }),

  mcpConfigs: (workspaceRoot?: string) =>
    queryOptions({
      queryKey: queryKeys.meta.mcpConfigs(workspaceRoot),
      queryFn: () => api("GET /api/meta/mcp-configs", { query: workspaceRoot ? { workspace_root: workspaceRoot } : undefined }),
    }),

  /**
   * MCP Servers — 从 snail-mcp-server 的 /mcp/ 端点获取内建 server 列表。
   * 注意：/mcp 端点是 MCP Server 自身的 JSON-RPC 端点，不经过 /api 网关，
   * 因此不使用 api() 客户端，直接 fetch。
   */
  mcpServers: () =>
    queryOptions({
      queryKey: queryKeys.meta.mcpServers,
      queryFn: async () => {
        const res = await fetch("/mcp-server");
        if (!res.ok) throw new ApiError("Failed to fetch MCP servers", res.status);
        const data = await res.json() as McpServerListResponse;
        return data.servers;
      },
    }),

  /**
   * MCP Server 详情 — 从 /mcp/:serverName 获取单个 server 的 tool 详情。
   * 同上，/mcp 端点不经过 /api 网关。
   */
  mcpServerDetail: (serverName: string) =>
    queryOptions({
      queryKey: [...queryKeys.meta.mcpServers, serverName] as const,
      queryFn: async () => {
        const res = await fetch(`/mcp-server/${encodeURIComponent(serverName)}`);
        if (!res.ok) throw new ApiError(`Failed to fetch MCP server: ${serverName}`, res.status);
        return res.json() as Promise<McpServerDetail>;
      },
      enabled: !!serverName,
    }),

  snailDen: () =>
    queryOptions({
      queryKey: queryKeys.meta.snailDen,
      queryFn: () => api("GET /api/snail-den"),
    }),
};
