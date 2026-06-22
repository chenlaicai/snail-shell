import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

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

  mcps: (workspaceRoot?: string) =>
    queryOptions({
      queryKey: queryKeys.meta.mcps(workspaceRoot),
      queryFn: () => api("GET /api/meta/mcps", { query: workspaceRoot ? { workspace_root: workspaceRoot } : undefined }),
    }),

  /** MCP Servers — 从 snail-mcp-server 的 /mcp/ 端点获取内建 server 列表 */
  mcpServers: () =>
    queryOptions({
      queryKey: queryKeys.meta.mcpServers,
      queryFn: async () => {
        const res = await fetch("/mcp");
        if (!res.ok) throw new Error("Failed to fetch MCP servers");
        const data = await res.json() as { servers: Array<{ name: string; version: string; endpoint: string; tools: string[] }> };
        return data.servers;
      },
    }),

  /** MCP Server 详情 — 从 /mcp/:serverName 获取单个 server 的 tool 详情 */
  mcpServerDetail: (serverName: string) =>
    queryOptions({
      queryKey: [...queryKeys.meta.mcpServers, serverName] as const,
      queryFn: async () => {
        const res = await fetch(`/mcp/${encodeURIComponent(serverName)}`);
        if (!res.ok) throw new Error(`Failed to fetch MCP server: ${serverName}`);
        return res.json() as Promise<{ name: string; version: string; endpoint: string; tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }>;
      },
      enabled: !!serverName,
    }),

  snailDen: () =>
    queryOptions({
      queryKey: queryKeys.meta.snailDen,
      queryFn: () => api("GET /api/snail-den"),
    }),
};
