import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { workspaceQueries } from "../../queries/workspace.queries";

export function WorkspaceTree() {
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const { data: workspaces = [], isLoading } = useQuery(workspaceQueries.list());

  if (isLoading) {
    return <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">正在加载工作区...</div>;
  }

  if (workspaces.length === 0) {
    return <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无工作区</div>;
  }

  return (
    <>
      {workspaces.map((workspace) => {
        const isActive = workspaceId === workspace.id;
        return (
          <div key={workspace.id} className={`rounded-[var(--radius-sm)] ${isActive ? "bg-[var(--color-bg-active)]" : ""}`}>
            <button className="flex items-center w-full px-[var(--space-sm)] py-[var(--space-xs)] text-left text-[var(--font-size-sm)] rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--color-bg-elevated)]" type="button" onClick={() => navigate(`/workspaces/${workspace.id}`)}>
              <span className="flex items-center justify-between w-full min-w-0">
                <span className="flex items-center gap-[var(--space-xs)] min-w-0">
                  <span className="text-[10px] text-[var(--color-text-grey)]">{isActive ? "▾" : "▸"}</span>
                  <span className={`truncate ${isActive ? "text-[var(--color-accent)] font-semibold" : "text-[var(--color-text-secondary)]"}`}>{workspace.summary || workspace.path}</span>
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}
