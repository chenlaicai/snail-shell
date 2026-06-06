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
          <div key={ws.id} className={`tree-workspace-node${isActive ? " active" : ""}`}>
            <button className="tree-workspace" type="button" onClick={() => navigate(`/ws/${ws.id}`)}>
              <span>
                <span className="node-header">
                  <span className="node-main">
                    <span className="chevron">{isActive ? "▾" : "▸"}</span>
                    <span className="node-title">{ws.name}</span>
                  </span>
                  {ws.boss_pending_count > 0 && (
                    <span className="pending-badge">@{ws.boss_pending_count}</span>
                  )}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}
