import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateIssue(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api<"POST /api/workspaces/:workspaceId/issues">>[1] extends { body: infer B } ? B : never) =>
      api("POST /api/workspaces/:workspaceId/issues", { params: { workspaceId }, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.issues.list(workspaceId) }),
  });
}

export function useUpdateIssue(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api<"PATCH /api/issues/:issueId">>[1] extends { body: infer B } ? B : never) =>
      api("PATCH /api/issues/:issueId", { params: { issueId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.all });
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
    },
  });
}

export function useCloseIssue(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/issues/:issueId/close", { params: { issueId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.all });
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
    },
  });
}
