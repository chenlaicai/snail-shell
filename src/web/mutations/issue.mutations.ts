import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateIssue(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; summary?: string; adopted_sop_id?: string }) =>
      api("POST /api/workspaces/:workspaceId/issues", { params: { workspaceId }, body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) }); },
  });
}

export function useAdvanceIssue(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { target_stage_key?: string }) =>
      api("POST /api/issues/:issueId/advance", { params: { issueId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      qc.invalidateQueries({ queryKey: queryKeys.issues.stages(issueId) });
    },
  });
}

export function useBounceStage(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { target_stage_key: string }) =>
      api("POST /api/issues/:issueId/bounce-stage", { params: { issueId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      qc.invalidateQueries({ queryKey: queryKeys.issues.stages(issueId) });
    },
  });
}

export function useArchiveIssue(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/issues/:issueId/archive", { params: { issueId } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) }); },
  });
}

export function useSetTaskAnchor(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { task_anchor: string }) =>
      api("PATCH /api/issues/:issueId/task-anchor", { params: { issueId }, body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) }); },
  });
}

export function useConfirmStageSuggestion(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/issues/:issueId/confirm-stage-suggestion", { params: { issueId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      qc.invalidateQueries({ queryKey: queryKeys.issues.stages(issueId) });
    },
  });
}
