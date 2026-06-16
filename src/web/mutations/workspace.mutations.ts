import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { path: string; summary?: string }) => api("POST /api/workspaces", { body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.workspaces.all }); },
  });
}
