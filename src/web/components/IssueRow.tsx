import { useNavigate, useParams } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { formatRelativeTime } from "@/lib/utils";
import type { IssueDetailDto } from "@/types";

export function IssueRow({ issue }: { issue: IssueDetailDto }) {
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const stage = issue.current_stage;
  const isDone = stage?.status === "completed";

  return (
    <div
      className={`flex items-center px-6 h-10 cursor-pointer border-l-2 border-transparent hover:border-l-shell-500 transition-colors hover:bg-white/3 ${isDone ? "opacity-60 hover:opacity-80" : ""}`}
      onClick={() => navigate(`/ws/${workspaceId}/issue/${issue.id}`)}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-[11px] text-text-muted font-mono shrink-0">{issue.id.slice(0, 8)}</span>
        <span className={`text-[13px] font-medium truncate ${isDone ? "line-through decoration-text-muted/50" : ""}`}>{issue.title}</span>
      </div>
      <div className="w-28 shrink-0 flex items-center justify-center">
        {stage && <StatusBadge status={stage.status} />}
      </div>
      <div className="w-40 shrink-0 text-[12px] text-text-muted truncate">{stage?.stage_definition?.title ?? "—"}</div>
      <div className="w-20 shrink-0 text-right text-[11px] text-text-muted">{formatRelativeTime(issue.updated_at)}</div>
    </div>
  );
}
