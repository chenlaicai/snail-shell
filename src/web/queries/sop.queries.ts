import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const sopQueries = {
  list: (source?: "platform" | "workspace") =>
    queryOptions({
      queryKey: queryKeys.sops.list(source),
      queryFn: () => api("GET /api/sops", { query: source ? { source } : undefined }),
    }),

  detail: (sopId: string) =>
    queryOptions({
      queryKey: queryKeys.sops.detail(sopId),
      queryFn: () => api("GET /api/sops/:sopId", { params: { sopId } }),
    }),
};
