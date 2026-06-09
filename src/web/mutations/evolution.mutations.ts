import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateEvolutionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string; content: string; workspace_id: string;
      tags?: string[]; metadata?: string;
    }) => api("POST /api/evolution/items", { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.evolution.items() });
    },
  });
}

export function useUpdateEvolutionItem(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      issue_id?: string; title?: string; content?: string;
      tags?: string[]; metadata?: string;
    }) => api("PATCH /api/evolution/items/:itemId", { params: { itemId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.evolution.items() });
      qc.invalidateQueries({ queryKey: queryKeys.evolution.detail(itemId) });
    },
  });
}
