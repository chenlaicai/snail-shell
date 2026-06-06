import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const evolutionQueries = {
  list: (filters?: { workspace_id?: string; issue_id?: string; query?: string; limit?: number; offset?: number }) =>
    queryOptions({
      queryKey: queryKeys.evolution.list(filters),
      queryFn: () => api("GET /api/evolution/items", { query: filters }),
    }),

  detail: (itemId: string) =>
    queryOptions({
      queryKey: queryKeys.evolution.detail(itemId),
      queryFn: () => api("GET /api/evolution/items/:itemId", { params: { itemId } }),
    }),
};
