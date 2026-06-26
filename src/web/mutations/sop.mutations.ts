import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import type { SopDto } from "@api-contracts/dto";

export function useCreateSop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<SopDto, 'scope'>) => api("POST /api/sops", { body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.sops.all }); },
  });
}

export function useUpdateSop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sopKey, ...body }: { sopKey: string } & Partial<Omit<SopDto, 'key' | 'scope'>>) =>
      api("PATCH /api/sops/:sopKey", { params: { sopKey }, body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.sops.all }); },
  });
}

export function useDeleteSop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sopKey: string) => api("DELETE /api/sops/:sopKey", { params: { sopKey } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.sops.all }); },
  });
}
