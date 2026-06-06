import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const knowledgeQueries = {
  list: (filters?: { scope?: "global" | "workspace"; workspace_id?: string; limit?: number; offset?: number }) =>
    queryOptions({
      queryKey: queryKeys.knowledge.list(filters),
      queryFn: () => api("GET /api/knowledge/items", { query: filters }),
    }),

  search: (q: string) =>
    queryOptions({
      queryKey: queryKeys.knowledge.search(q),
      queryFn: () => api("GET /api/knowledge/items/search", { query: { q } }),
      enabled: !!q,
    }),

  summary: () =>
    queryOptions({
      queryKey: ["knowledge", "summary"],
      queryFn: () => api("GET /api/knowledge/items/summary"),
    }),
};
