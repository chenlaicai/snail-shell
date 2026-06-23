import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateIssue(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; summary?: string; adopted_sop_key: string; snail_assignment_plan: Record<string, Record<string, string>> }) =>
      api("POST /api/workspaces/:workspaceId/issues", { params: { workspaceId }, body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) }); },
  });
}

export function useCloseIssue(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) =>
      api("POST /api/issues/:issueId/close", { params: { issueId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
    },
  });
}
