import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/services/api-client";
import { queryKeys } from "@/queries/keys";
import { TopBar } from "@/components/TopBar";
import { IssueCard } from "@/components/IssueCard";
import { NewIssueDialog } from "@/components/NewIssueDialog";
import { groupByActivityStatus, activityStatusColumns } from "@/lib/issue-utils";
import { useWorkspaceRealtime } from "@/hooks/useWorkspaceRealtime";
import { navTrace } from "@/lib/nav-trace";
import type { IssueDetailDto } from "@/types";

/** 根据 WebSocket 状态返回连接指示器样式和文案 */
function getWsIndicator(status: string) {
  switch (status) {
    case "connecting":
      return { color: "bg-gray-400", text: "Connecting..." };
    case "disconnected":
      return { color: "bg-yellow-400", text: "Disconnected \u2014 reconnecting..." };
    case "error":
      return { color: "bg-red-400", text: "Connection error" };
    default:
      return null;
  }
}

export function IssueBoard() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showNewIssue, setShowNewIssue] = useState(false);

  const wsStatus = useWorkspaceRealtime(workspaceId ?? null);
  const wsIndicator = getWsIndicator(wsStatus);

  const { data: workspace, isLoading: wsLoading } = useQuery({
    queryKey: queryKeys.workspaces.detail(workspaceId ?? ""),
    queryFn: () => api("GET /api/workspaces/:workspaceId", { params: { workspaceId: workspaceId! } }),
    enabled: !!workspaceId,
  });

  const { data: issues = [] } = useQuery({
    queryKey: queryKeys.workspaces.issues(workspaceId ?? ""),
    queryFn: () => api("GET /api/workspaces/:workspaceId/issues", { params: { workspaceId: workspaceId! } }) as Promise<IssueDetailDto[]>,
    enabled: !!workspaceId,
    refetchOnWindowFocus: true,
    refetchInterval: wsStatus !== "connected" ? 10_000 : false,
  });

  const grouped = groupByActivityStatus(issues);

  return (
    <>
      <TopBar breadcrumbs={[
        { label: "Workspaces", to: "/workspaces" },
        // || not ??: empty string should fall back to path (see F2026062203 D3)
        { label: wsLoading ? "Loading..." : (workspace?.summary || workspace?.path || workspaceId || ""), to: `/workspaces/${workspaceId}/board` },
        { label: "Board" },
      ]} />

      {wsIndicator && (
        <div className="flex items-center gap-2 px-6 py-2 bg-surface-1 border-b border-white/4 text-xs text-text-secondary shrink-0">
          <div className={`w-2 h-2 rounded-full ${wsIndicator.color}`} />
          <span>{wsIndicator.text}</span>
          <button
            onClick={() => workspaceId && queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) })}
            className="ml-auto px-2 py-0.5 rounded bg-white/8 hover:bg-white/12 text-xs transition-colors"
          >
            Refresh
          </button>
        </div>
      )}

      <div className="flex items-center px-6 py-3 gap-3 border-b border-white/4 shrink-0">
        <div className="flex items-center bg-surface-2 rounded-md border border-white/6 p-0.5">
          <button onClick={() => {
            navTrace("navigate", { from: location.pathname, to: `/workspaces/${workspaceId}/list` });
            navigate(`/workspaces/${workspaceId}/list`);
          }} className="px-2.5 py-1 rounded text-xs text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            List
          </button>
          <button className="px-2.5 py-1 rounded text-xs bg-white/8 text-text-primary font-medium flex items-center gap-1.5">
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

      <div className="flex-1 min-h-0 overflow-y-hidden px-6 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full min-h-0">
          {issues.length === 0 ? (
            <div className="col-span-full text-center text-text-muted text-sm py-16">No issues in this workspace</div>
          ) : (
            activityStatusColumns.map((col) => {
              const colIssues = grouped[col.status] ?? [];
              return (
                <div key={col.status} className="flex flex-col min-h-0">
                  <div className="flex items-center gap-2 px-2 py-2 mb-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
                    <span className="text-xs font-medium text-text-secondary">{col.label}</span>
                    <span className="text-xs text-text-muted ml-0.5">{colIssues.length}</span>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                    {colIssues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
                    {colIssues.length === 0 && <div className="text-center text-text-muted text-xs py-8">No issues</div>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {workspaceId && <NewIssueDialog workspaceId={workspaceId} open={showNewIssue} onClose={() => setShowNewIssue(false)} />}
    </>
  );
}
