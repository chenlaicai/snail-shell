import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const evolutionQueries = {
  items: (filters?: { workspace_id?: string; issue_id?: string; query?: string }) => ({
    queryKey: queryKeys.evolution.items(filters),
    queryFn: () => api("GET /api/evolution/items", { query: filters }),
  }),
  detail: (id: string) => ({
    queryKey: queryKeys.evolution.detail(id),
    queryFn: () => api("GET /api/evolution/items/:itemId", { params: { itemId: id } }),
  }),
};
