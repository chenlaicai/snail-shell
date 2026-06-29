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
 * 2. onSuccess: 删除 localStorage（不更新缓存 status，让 WebSocket 事件完成替换）
 * 3. onError: 标记 status="failed" + 更新 localStorage（不回滚缓存）
 * 4. onSettled: invalidateQueries 兜底，确保最终一致
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
      /** 发送成功：删除 localStorage 条目。
       *  不在这里更新缓存 status —— 保留 "sending" 让 WebSocket user_called
       *  事件能通过 replaceOptimisticMessage 匹配并替换为服务端真实消息。
       *  onSettled 的 invalidateQueries 作为兜底，确保最终一致。
       */
      removePendingMessage(stageId, context.optimisticId);
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
