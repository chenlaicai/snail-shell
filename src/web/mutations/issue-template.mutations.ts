import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import { showToast } from "../components/Toast";

export function useCreateIssueTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      workspace_path: string;
      title: string;
      sop_key: string;
      snail_assignment_plan: Record<string, Record<string, string>>;
      cron_expression: string;
      enabled?: boolean;
    }) => api("POST /api/issue-templates", { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issueTemplates.all });
      showToast("Issue Template created");
    },
    onError: (err: unknown) => {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`, true);
    },
  });
}

export function useUpdateIssueTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & {
      title?: string;
      sop_key?: string;
      snail_assignment_plan?: Record<string, Record<string, string>>;
      cron_expression?: string;
      enabled?: boolean;
    }) => api("PUT /api/issue-templates/:id", { params: { id }, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issueTemplates.all });
      showToast("Issue Template updated");
    },
    onError: (err: unknown) => {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`, true);
    },
  });
}

export function useDeleteIssueTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE /api/issue-templates/:id", { params: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issueTemplates.all });
      showToast("Issue Template deleted");
    },
    onError: (err: unknown) => {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`, true);
    },
  });
}

export function useToggleIssueTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("PATCH /api/issue-templates/:id/toggle", { params: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issueTemplates.all });
    },
    onError: (err: unknown) => {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`, true);
    },
  });
}
