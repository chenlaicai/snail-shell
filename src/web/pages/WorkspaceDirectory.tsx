import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { workspaceQueries } from "@/queries/workspace.queries";
import { TopBar } from "@/components/TopBar";
import type { WorkspaceSummaryDto } from "@/types";

export function WorkspaceDirectory() {
  const navigate = useNavigate();
  const { data: workspaces = [], isLoading } = useQuery(workspaceQueries.list());

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Workspaces" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Workspaces</h1>
            <p className="mt-1 text-[13px] text-text-secondary">Choose a workspace to inspect its issues and stages.</p>
          </div>
          <button
            onClick={() => navigate("/workspaces/new")}
            className="rounded-md bg-shell-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-shell-500"
          >
            New Workspace
          </button>
        </div>

        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-text-muted">Loading workspaces...</div>
        ) : workspaces.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-surface-1 px-8 py-12 text-center">
            <div className="text-sm font-medium text-text-primary">No workspaces yet</div>
            <div className="mt-2 text-[13px] text-text-muted">Create one to start issue collaboration.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(workspaces as WorkspaceSummaryDto[]).map((workspace) => (
              <button
                key={workspace.id}
                onClick={() => navigate(`/workspaces/${workspace.id}/board`)}
                className="group rounded-xl border border-white/6 bg-surface-1 p-4 text-left transition-colors hover:border-white/10 hover:bg-surface-2"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-shell-600/15 text-shell-400">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text-primary group-hover:text-shell-400">{workspace.path}</div>
                    <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-text-muted">{workspace.summary || "No summary"}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
