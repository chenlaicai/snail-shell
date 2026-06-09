import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string; summary?: string; workspace_root?: string;
      sop_id: string; role_snail_mapping?: Record<string, Record<string, string>>;
      load_from_snail?: boolean;
    }) => api("POST /api/workspaces", { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
}

export function useDetectSnail() {
  return useMutation({
    mutationFn: (body: { workspace_root: string }) =>
      api("POST /api/workspaces/detect-snail", { body }),
  });
}

export function useLoadSnail(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/workspaces/:workspaceId/load-snail", { params: { workspaceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) });
    },
  });
}
