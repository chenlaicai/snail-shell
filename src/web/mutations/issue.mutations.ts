import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateIssue(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; summary?: string; adopted_sop_id?: string }) =>
      api("POST /api/workspaces/:workspaceId/issues", { params: { workspaceId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) });
    },
  });
}

export function useAdvanceIssue(issueId: string, workspaceId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { target_stage_key?: string }) =>
      api("POST /api/issues/:issueId/advance", { params: { issueId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      if (workspaceId) qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
    },
  });
}

export function useBounceStage(issueId: string, workspaceId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { target_stage_key: string }) =>
      api("POST /api/issues/:issueId/bounce-stage", { params: { issueId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      if (workspaceId) qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
    },
  });
}

export function useCompleteIssue(issueId: string, workspaceId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/issues/:issueId/complete", { params: { issueId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      if (workspaceId) qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
    },
  });
}

export function useArchiveIssue(issueId: string, workspaceId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/issues/:issueId/archive", { params: { issueId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      if (workspaceId) qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
    },
  });
}

export function useUpdateTaskAnchor(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { task_anchor: string }) =>
      api("PATCH /api/issues/:issueId/task-anchor", { params: { issueId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
    },
  });
}

export function useUpdateRoleSnail(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { stage_id: string; role_name: string; snail_template_id: string }) =>
      api("PATCH /api/issues/:issueId/role-snail", { params: { issueId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
    },
  });
}

export function useConfirmStageSuggestion(issueId: string, workspaceId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/issues/:issueId/confirm-stage-suggestion", { params: { issueId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      qc.invalidateQueries({ queryKey: queryKeys.issues.stageSuggestion(issueId) });
      if (workspaceId) qc.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
    },
  });
}

export function useRejectStageSuggestion(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/issues/:issueId/reject-stage-suggestion", { params: { issueId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.stageSuggestion(issueId) });
    },
  });
}
