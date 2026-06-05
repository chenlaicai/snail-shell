import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const workspaceQueries = {
  list: (query?: { limit?: number; offset?: number }) =>
    queryOptions({
      queryKey: queryKeys.workspaces.list(query),
      queryFn: () => api("GET /api/workspaces", { query }),
    }),

  detail: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.detail(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId", { params: { workspaceId } }),
    }),

  issues: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.issues(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId/issues", { params: { workspaceId } }),
    }),

  stages: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.stages(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId/stages", { params: { workspaceId } }),
    }),
};
