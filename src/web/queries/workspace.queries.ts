import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";
import { WorkspaceSummarySchema, IssueDetailSchema } from "../../api-contracts/validators";
import type { IssueDetail, Conversation } from "../types";

export const workspaceQueries = {
  list: (query?: { limit?: number; offset?: number }) =>
    queryOptions({
      queryKey: queryKeys.workspaces.list(query),
      queryFn: () => api("GET /api/workspaces", { query, schema: WorkspaceSummarySchema.array() }),
    }),

  detail: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.detail(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId", { params: { workspaceId } }),
    }),

  issues: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.issues(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId/issues", { params: { workspaceId }, schema: IssueDetailSchema.array() }),
    }),

  stages: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.stages(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId/stages", { params: { workspaceId } }),
    }),
};

export const issueQueries = {
  detail: (issueId: string) =>
    queryOptions({
      queryKey: queryKeys.issues.detail(issueId),
      queryFn: (): Promise<IssueDetail> => api("GET /api/issues/:issueId", { params: { issueId } }),
    }),

  stageConversations: (stageId: string) =>
    queryOptions({
      queryKey: queryKeys.stages.conversations(stageId),
      queryFn: (): Promise<Conversation[]> => api("GET /api/stages/:stageId/conversations", { params: { stageId } }),
    }),
};
