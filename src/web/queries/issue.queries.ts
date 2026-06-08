import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const issueQueries = {
  list: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.issues.list(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId/issues", { params: { workspaceId } }),
    }),

  detail: (issueId: string) =>
    queryOptions({
      queryKey: queryKeys.issues.detail(issueId),
      queryFn: () => api("GET /api/issues/:issueId", { params: { issueId } }),
    }),

  stages: (issueId: string) =>
    queryOptions({
      queryKey: queryKeys.issues.stages(issueId),
      queryFn: () => api("GET /api/issues/:issueId/stages", { params: { issueId } }),
    }),
};
