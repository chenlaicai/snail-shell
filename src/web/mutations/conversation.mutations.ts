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
      // 避免同毫秒内多条消息 ID 冲突：毫秒时间戳 × 1000 + 随机 0-999
      const optimisticId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
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
