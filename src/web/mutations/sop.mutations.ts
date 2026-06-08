import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api-client.js";
import { queryKeys } from "@/queries/keys.js";
import type { ApiEndpoints } from "@/api-contracts/endpoints.js";

export function useCreateSop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApiEndpoints["POST /api/sops"]["body"]) =>
      api("POST /api/sops", { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sops.all }),
  });
}

export function useUpdateSop(sopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApiEndpoints["PATCH /api/sops/:sopId"]["body"]) =>
      api("PATCH /api/sops/:sopId", { params: { sopId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sops.all });
      qc.invalidateQueries({ queryKey: queryKeys.sops.detail(sopId) });
    },
  });
}

export function useDeleteSop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sopId: string) => api("DELETE /api/sops/:sopId", { params: { sopId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sops.all }),
  });
}
