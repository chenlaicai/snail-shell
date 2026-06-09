import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const sopQueries = {
  all: () => ({
    queryKey: queryKeys.sops.all,
    queryFn: () => api("GET /api/sops"),
  }),
  detail: (id: string) => ({
    queryKey: queryKeys.sops.detail(id),
    queryFn: () => api("GET /api/sops/:sopId", { params: { sopId: id } }),
  }),
};
