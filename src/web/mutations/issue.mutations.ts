import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import { navTrace, registerPendingMutationProvider } from "../lib/nav-trace";
import type { CloseIssueResultDto, IssueDetailDto } from "@/types";

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
  const closeMutation = useMutation({
    mutationFn: (issueId: string): Promise<CloseIssueResultDto> =>
      api("POST /api/issues/:issueId/close", { params: { issueId } }),

    onMutate: async (issueId) => {
      navTrace("close_issue_on_mutate", { issueId });

      await qc.cancelQueries({ queryKey: queryKeys.issues.detail(issueId) });
      await qc.cancelQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });

      const prevDetail = qc.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
      const prevList = qc.getQueryData<IssueDetailDto[]>(queryKeys.workspaces.issues(workspaceId));

      const closedAt = new Date().toISOString();
      if (prevDetail) {
        qc.setQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId), {
          ...prevDetail,
          closed_at: closedAt,
        });
      }
      if (prevList) {
        qc.setQueryData<IssueDetailDto[]>(
          queryKeys.workspaces.issues(workspaceId),
          prevList.map(issue =>
            issue.id === issueId
              ? { ...issue, closed_at: closedAt, activity_status: "completed" as const }
              : issue
          ),
        );
      }

      return { prevDetail, prevList };
    },

    onError: (_err, issueId, context) => {
      navTrace("close_issue_on_error", { issueId, error: _err instanceof Error ? _err.message : String(_err) });

      if (context?.prevDetail) {
        qc.setQueryData(queryKeys.issues.detail(issueId), context.prevDetail);
      }
      if (context?.prevList) {
        qc.setQueryData(queryKeys.workspaces.issues(workspaceId), context.prevList);
      }
    },

    onSuccess: (data, issueId) => {
      navTrace("close_issue_on_success", { issueId });
      qc.setQueryData(queryKeys.issues.detail(issueId), data.issue);
    },
  });

  // 注册 pending mutation 提供器，供 nav-trace pagehide 快照使用
  registerPendingMutationProvider(() => closeMutation.isPending);

  return closeMutation;
}
