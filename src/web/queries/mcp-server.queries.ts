import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const mcpServerQueries = {
  info: () =>
    queryOptions({
      queryKey: queryKeys.mcpServer.info,
      queryFn: () => api("GET /api/mcp-server/info"),
    }),

  tools: () =>
    queryOptions({
      queryKey: queryKeys.mcpServer.tools,
      queryFn: () => api("GET /api/mcp-server/tools"),
    }),
};
