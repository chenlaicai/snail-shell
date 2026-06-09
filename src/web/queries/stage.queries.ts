import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const stageQueries = {
  detail: (id: string) => ({
    queryKey: queryKeys.stages.detail(id),
    queryFn: () => api("GET /api/stages/:stageId", { params: { stageId: id } }),
  }),
  conversations: (id: string) => ({
    queryKey: queryKeys.stages.conversations(id),
    queryFn: () => api("GET /api/stages/:stageId/conversations", { params: { stageId: id } }),
  }),
};
