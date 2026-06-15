import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateIssue(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; summary?: string; adopted_sop_key: string; initial_message?: string; snail_assignments?: Record<string, string> }) =>
      api("POST /api/workspaces/:workspaceId/issues", { params: { workspaceId }, body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) }); },
  });
}
