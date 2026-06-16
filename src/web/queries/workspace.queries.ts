import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";
import { WorkspaceSummaryDtoSchema, IssueDetailDtoSchema } from "@api-contracts/validators";
import type { IssueDetailDto } from "../types";

export const workspaceQueries = {
  list: (query?: { limit?: number; offset?: number }) =>
    queryOptions({
      queryKey: queryKeys.workspaces.list(query),
      queryFn: () => api("GET /api/workspaces", { query, schema: WorkspaceSummaryDtoSchema.array() }),
    }),

  detail: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.detail(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId", { params: { workspaceId } }),
    }),

  issues: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.issues(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId/issues", { params: { workspaceId }, schema: IssueDetailDtoSchema.array() }),
    }),
};

export const issueQueries = {
  detail: (issueId: string) =>
    queryOptions({
      queryKey: queryKeys.issues.detail(issueId),
      queryFn: (): Promise<IssueDetailDto> => api("GET /api/issues/:issueId", { params: { issueId } }),
    }),
};
