import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; summary?: string; workspace_root?: string; sop_id: string; role_bindings?: Record<string, string | string[]>; load_from_snail?: boolean }) =>
      api("POST /api/workspaces", { body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.workspaces.all }); },
  });
}

export function useLoadSnail(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/workspaces/:workspaceId/load-snail", { params: { workspaceId } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) }); },
  });
}
