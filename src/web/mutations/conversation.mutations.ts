import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import { createPlaceholderMessage } from "../hooks/useWebSocket";
import type { MessageDto } from "../types";

export function useSendMessage(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; from_speaker?: string; to_speakers?: string[] }) =>
      api("POST /api/stages/:stageId/messages", { params: { stageId }, body }),

    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: queryKeys.stages.messages(stageId) });
      const previous = qc.getQueryData<MessageDto[]>(queryKeys.stages.messages(stageId));
      const optimisticId = Date.now();
      qc.setQueryData(queryKeys.stages.messages(stageId), (old: MessageDto[] | undefined) => [
        createPlaceholderMessage(stageId, { id: optimisticId, role: "user", status: "completed", content: body.text }),
        ...(old ?? []),
      ]);
      return { previous, optimisticId };
    },

    onError: (_err, _body, context) => {
      if (context?.previous) {
        qc.setQueryData(queryKeys.stages.messages(stageId), context.previous);
      }
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
    },
  });
}
