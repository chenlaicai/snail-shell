import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const workspaceQueries = {
  list: () => ({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => api("GET /api/workspaces"),
  }),
  detail: (id: string) => ({
    queryKey: queryKeys.workspaces.detail(id),
    queryFn: () => api("GET /api/workspaces/:workspaceId", { params: { workspaceId: id } }),
  }),
  issues: (id: string) => ({
    queryKey: queryKeys.workspaces.issues(id),
    queryFn: () => api("GET /api/workspaces/:workspaceId/issues", { params: { workspaceId: id } }),
  }),
  stages: (id: string) => ({
    queryKey: queryKeys.workspaces.stages(id),
    queryFn: () => api("GET /api/workspaces/:workspaceId/stages", { params: { workspaceId: id } }),
  }),
  conversations: (id: string) => ({
    queryKey: queryKeys.workspaces.conversations(id),
    queryFn: () => api("GET /api/workspaces/:workspaceId/conversations", { params: { workspaceId: id } }),
  }),
  evolution: (id: string, filters?: { issue_id?: string; query?: string }) => ({
    queryKey: [...queryKeys.workspaces.evolution(id), filters] as const,
    queryFn: () => api("GET /api/workspaces/:workspaceId/evolution/items", { params: { workspaceId: id }, query: filters }),
  }),
};
