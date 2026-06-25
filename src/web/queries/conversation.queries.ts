import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";
import { MessageDtoSchema } from "@api-contracts/validators";

export const conversationQueries = {
  detail: (stageId: string) =>
    queryOptions({
      queryKey: queryKeys.stages.detail(stageId),
      queryFn: () => api("GET /api/stages/:stageId", { params: { stageId } }),
    }),

  messages: (stageId: string, query?: { limit?: number; before_id?: number }) =>
    queryOptions({
      queryKey: queryKeys.stages.messages(stageId),
      queryFn: () => api("GET /api/stages/:stageId/messages", { params: { stageId }, query, schema: MessageDtoSchema.array() }),
      staleTime: 0,
    }),
};
