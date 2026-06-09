import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../services/api-client";
import type { WorkspaceSummaryDto } from "../../types";

export function WorkspaceTree() {
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryDto[]>([]);

  useEffect(() => {
    api("GET /api/workspaces").then(setWorkspaces).catch(() => {});
  }, []);

  if (workspaces.length === 0) {
    return <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无工作区</div>;
  }

  return (
    <>
      {workspaces.map((ws) => {
        const isActive = workspaceId === ws.id;
        return (
          <div key={ws.id} className={`rounded-[var(--radius-sm)] ${isActive ? "bg-[var(--color-bg-active)]" : ""}`}>
            <button className="flex items-center w-full px-[var(--space-sm)] py-[var(--space-xs)] text-left text-[var(--font-size-sm)] rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--color-bg-elevated)]" type="button" onClick={() => navigate(`/ws/${ws.id}`)}>
              <span className="flex items-center justify-between w-full min-w-0">
                <span className="flex items-center gap-[var(--space-xs)] min-w-0">
                  <span className="text-[10px] text-[var(--color-text-grey)]">{isActive ? "▾" : "▸"}</span>
                  <span className={`truncate ${isActive ? "text-[var(--color-accent)] font-semibold" : "text-[var(--color-text-secondary)]"}`}>{ws.name}</span>
                </span>
                {ws.boss_pending_count > 0 && (
                  <span className="shrink-0 ml-[var(--space-xs)] text-[9px] px-1 py-px rounded-full bg-[rgba(251,191,36,0.15)] text-[var(--color-warning-text)]">@{ws.boss_pending_count}</span>
                )}
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}
