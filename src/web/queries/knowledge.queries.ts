import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const knowledgeQueries = {
  summary: () => ({
    queryKey: queryKeys.knowledge.summary,
    queryFn: () => api("GET /api/knowledge/items/summary"),
  }),
  items: (filters?: { scope?: string; workspace_id?: string }) => ({
    queryKey: queryKeys.knowledge.items(filters),
    queryFn: () => api("GET /api/knowledge/items", { query: filters }),
  }),
  detail: (id: string) => ({
    queryKey: queryKeys.knowledge.detail(id),
    queryFn: () => api("GET /api/knowledge/items/:id", { params: { id } }),
  }),
  search: (q: string) => ({
    queryKey: queryKeys.knowledge.search(q),
    queryFn: () => api("GET /api/knowledge/items/search", { query: { q } }),
    enabled: q.length > 0,
  }),
};
