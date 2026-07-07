import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import type { EvolutionItemDto } from "@/types";

export function useCreateIssueFromItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string): Promise<EvolutionItemDto> =>
      api("POST /api/evolution/items/:itemId/create-issue", { params: { itemId } }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.evolution.list() });
      qc.setQueryData(queryKeys.evolution.detail(data.id), data);
    },
  });
}

export function useCloseEvolutionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, result }: { itemId: string; result?: string }): Promise<EvolutionItemDto> =>
      api("POST /api/evolution/items/:itemId/close", { params: { itemId }, body: { result } }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.evolution.list() });
      qc.setQueryData(queryKeys.evolution.detail(data.id), data);
    },
  });
}
