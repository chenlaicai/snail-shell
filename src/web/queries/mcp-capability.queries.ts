import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const mcpCapabilityQueries = {
  servers: () =>
    queryOptions({
      queryKey: queryKeys.mcpCapability.servers,
      queryFn: () => api("GET /api/mcp-capability/servers"),
    }),

  platformServers: () =>
    queryOptions({
      queryKey: queryKeys.mcpCapability.platformServers,
      queryFn: () => api("GET /api/mcp-capability/platform-servers"),
    }),

  workspaceServers: () =>
    queryOptions({
      queryKey: queryKeys.mcpCapability.workspaceServers,
      queryFn: () => api("GET /api/mcp-capability/workspace-servers"),
    }),
};
