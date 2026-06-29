import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import { createPlaceholderMessage } from "../hooks/useWebSocket";
import {
  generateOptimisticId,
  savePendingMessage,
  removePendingMessage,
  markPendingMessageFailed,
} from "../lib/pending-messages";
import type { MessageDto } from "../types";

/**
 * 发送消息 mutation
 *
 * 设计要点：
 * 1. onMutate: 乐观更新 status="sending" + 写入 localStorage
 * 2. onSuccess: 更新 status="completed" + 删除 localStorage
 * 3. onError: 标记 status="failed" + 更新 localStorage（不回滚缓存）
 */
export function useSendMessage(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; from_speaker?: string; to_speakers?: string[] }) =>
      api("POST /api/stages/:stageId/messages", { params: { stageId }, body }),

    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: queryKeys.stages.messages(stageId) });
      const previous = qc.getQueryData<MessageDto[]>(queryKeys.stages.messages(stageId));
      const optimisticId = generateOptimisticId();

      /** 写入 localStorage，页面刷新时可恢复 */
      savePendingMessage({
        id: optimisticId,
        stageId,
        content: body.text,
        toSpeakers: body.to_speakers,
        createdAt: new Date().toISOString(),
        status: "sending",
      });

      /** 插入缓存，status = "sending"（前端专有状态） */
      qc.setQueryData(queryKeys.stages.messages(stageId), (old: MessageDto[] | undefined) => [
        createPlaceholderMessage(stageId, { id: optimisticId, role: "user", status: "sending", content: body.text }),
        ...(old ?? []),
      ]);

      return { previous, optimisticId };
    },

    onSuccess: (_data, _body, context) => {
      /** 发送成功：删除 localStorage 条目 */
      removePendingMessage(stageId, context.optimisticId);
      /** 更新缓存：status "sending" → "completed" */
      qc.setQueryData(queryKeys.stages.messages(stageId), (old: MessageDto[] | undefined) =>
        old?.map((m) => (m.id === context.optimisticId ? { ...m, status: "completed" } : m)),
      );
    },

    onError: (_err, _body, context) => {
      /** 发送失败：标记 localStorage 为 "failed" */
      markPendingMessageFailed(stageId, context.optimisticId);
      /** 更新缓存：status "sending" → "failed"（不回滚，保留消息在界面上） */
      qc.setQueryData(queryKeys.stages.messages(stageId), (old: MessageDto[] | undefined) =>
        old?.map((m) => (m.id === context.optimisticId ? { ...m, status: "failed" } : m)),
      );
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
    },
  });
}
