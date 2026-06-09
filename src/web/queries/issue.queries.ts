import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const issueQueries = {
  detail: (id: string) => ({
    queryKey: queryKeys.issues.detail(id),
    queryFn: () => api("GET /api/issues/:issueId", { params: { issueId: id } }),
  }),
  stages: (id: string) => ({
    queryKey: queryKeys.issues.stages(id),
    queryFn: () => api("GET /api/issues/:issueId/stages", { params: { issueId: id } }),
  }),
  conversations: (id: string) => ({
    queryKey: queryKeys.issues.conversations(id),
    queryFn: () => api("GET /api/issues/:issueId/conversations", { params: { issueId: id } }),
  }),
  stageSuggestion: (id: string) => ({
    queryKey: queryKeys.issues.stageSuggestion(id),
    queryFn: () => api("GET /api/issues/:issueId/stage-suggestion", { params: { issueId: id } }),
  }),
};
