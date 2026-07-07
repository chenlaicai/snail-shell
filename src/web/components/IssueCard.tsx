import { useNavigate, useParams } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { formatRelativeTime } from "@/lib/utils";
import type { IssueDetailDto } from "@/types";

export function IssueCard({ issue }: { issue: IssueDetailDto }) {
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  return (
    <div
      className="bg-surface-2 rounded-lg border border-white/6 p-3 cursor-pointer hover:bg-surface-3 hover:border-white/10 transition-colors"
      onClick={() => navigate(`/workspaces/${workspaceId}/issue/${issue.id}`)}
    >
      <div className="flex items-start gap-2 mb-2">
        <span className="text-[11px] text-text-muted font-medium mt-0.5 font-mono">{issue.id.slice(0, 8)}</span>
        <div className="flex-1 text-[13px] font-medium leading-snug">{issue.title}</div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <StatusBadge status={issue.activity_status} />
        {issue.sop_snapshot.name && (
          <span className="text-[11px] text-text-muted">SOP: {issue.sop_snapshot.name}</span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-muted">{formatRelativeTime(issue.updated_at)}</span>
      </div>
    </div>
  );
}
