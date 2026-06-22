import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/services/api-client";
import { queryKeys } from "@/queries/keys";
import { TopBar } from "@/components/TopBar";
import { IssueRow } from "@/components/IssueRow";
import { NewIssueDialog } from "@/components/NewIssueDialog";
import { groupByStatus, statusColumns } from "@/lib/issue-utils";
import type { IssueDetailDto } from "@/types";

export function IssueList() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: workspace, isLoading: wsLoading } = useQuery({
    queryKey: queryKeys.workspaces.detail(workspaceId ?? ""),
    queryFn: () => api("GET /api/workspaces/:workspaceId", { params: { workspaceId: workspaceId! } }),
    enabled: !!workspaceId,
  });

  const { data: issues = [] } = useQuery({
    queryKey: queryKeys.workspaces.issues(workspaceId ?? ""),
    queryFn: () => api("GET /api/workspaces/:workspaceId/issues", { params: { workspaceId: workspaceId! } }) as Promise<IssueDetailDto[]>,
    enabled: !!workspaceId,
  });

  const grouped = groupByStatus(issues);

  const toggle = (status: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  return (
    <>
      <TopBar breadcrumbs={[
        { label: "Workspaces", to: "/workspaces" },
        // || not ??: empty string should fall back to path (see F2026062202 D3)
        { label: wsLoading ? "Loading..." : (workspace?.summary || workspace?.path || workspaceId || ""), to: `/workspaces/${workspaceId}/board` },
        { label: "List" },
      ]} />

      <div className="flex items-center px-6 py-3 gap-3 border-b border-white/4 shrink-0">
        <div className="flex items-center bg-surface-2 rounded-md border border-white/6 p-0.5">
          <button className="px-2.5 py-1 rounded text-xs bg-white/8 text-text-primary font-medium flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            List
          </button>
          <button onClick={() => navigate(`/workspaces/${workspaceId}/board`)} className="px-2.5 py-1 rounded text-xs text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Board
          </button>
        </div>
        <div className="flex-1" />
        <button onClick={() => setShowNewIssue(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-xs font-medium transition-colors">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Issue
        </button>
      </div>

      <div className="sticky top-0 z-10 bg-surface-0 border-b border-white/6">
        <div className="flex items-center px-6 h-9 text-[11px] text-text-muted font-medium">
          <div className="flex-1 min-w-0">Issue</div>
          <div className="w-28 shrink-0 text-center">Status</div>
          <div className="w-40 shrink-0">Stage</div>
          <div className="w-20 shrink-0 text-right">Updated</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {issues.length === 0 ? (
          <div className="text-center text-text-muted text-sm py-16">No issues in this workspace</div>
        ) : (
          statusColumns.map((group) => {
            const groupIssues = grouped[group.status] ?? [];
            if (groupIssues.length === 0) return null;
            const isCollapsed = collapsed.has(group.status);
            return (
              <div key={group.status} className="mt-2">
                <div className="flex items-center gap-2 px-6 h-9 cursor-pointer select-none hover:bg-white/3 transition-colors" onClick={() => toggle(group.status)}>
                  <svg className={`w-3.5 h-3.5 text-text-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
                  <div className={`w-2 h-2 rounded-full ${group.dot}`} />
                  <span className="text-xs font-medium text-text-secondary">{group.label}</span>
                  <span className="text-xs text-text-muted">{groupIssues.length}</span>
                </div>
                {!isCollapsed && groupIssues.map((issue) => <IssueRow key={issue.id} issue={issue} />)}
              </div>
            );
          })
        )}
        <div className="h-12" />
      </div>

      {workspaceId && <NewIssueDialog workspaceId={workspaceId} open={showNewIssue} onClose={() => setShowNewIssue(false)} />}
    </>
  );
}
