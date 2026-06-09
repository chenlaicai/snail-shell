import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import type { UpdateStageBody } from "@/types";

export function useUpdateStage(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateStageBody) =>
      api("PATCH /api/stages/:stageId", { params: { stageId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.stages.detail(stageId) });
    },
  });
}
