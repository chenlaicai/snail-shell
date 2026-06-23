import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import type { SnailDenTemplateDto } from "@api-contracts/dto";

export function useCreateSnail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SnailDenTemplateDto) => api("POST /api/snail-den", { body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.meta.snailDen }); },
  });
}

export function useUpdateSnail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }: { key: string } & Partial<Omit<SnailDenTemplateDto, 'key'>>) =>
      api("PATCH /api/snail-den/:key", { params: { key }, body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.meta.snailDen }); },
  });
}

export function useDeleteSnail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api("DELETE /api/snail-den/:key", { params: { key } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.meta.snailDen }); },
  });
}
