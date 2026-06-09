import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import type { SopStageDefinitionInputDto, SopTransitionDto } from "@/types";

export function useCreateSop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      key: string; name: string; description?: string;
      first_stage?: string; shared_handbook?: string;
      stage_definitions: SopStageDefinitionInputDto[];
      transitions?: SopTransitionDto[];
    }) => api("POST /api/sops", { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sops.all });
    },
  });
}

export function useUpdateSop(sopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name?: string; description?: string;
      first_stage?: string; shared_handbook?: string;
      stage_definitions?: SopStageDefinitionInputDto[];
      transitions?: SopTransitionDto[];
    }) => api("PATCH /api/sops/:sopId", { params: { sopId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sops.all });
      qc.invalidateQueries({ queryKey: queryKeys.sops.detail(sopId) });
    },
  });
}

export function useDeleteSop(sopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("DELETE /api/sops/:sopId", { params: { sopId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sops.all });
    },
  });
}
