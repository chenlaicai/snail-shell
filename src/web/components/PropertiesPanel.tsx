import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import type { IssueDetailDto } from "@/types";

export function PropertiesPanel({ issue }: { issue: IssueDetailDto }) {
  const stage = issue.current_stage;

  return (
    <aside className="w-[280px] shrink-0 bg-surface-1 border-l border-white/6 flex flex-col overflow-y-auto">
      <div className="px-4 py-4 space-y-4">
        {/* Details */}
        <div>
          <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-3">Details</div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Status</span>
              {stage ? <StatusBadge status={stage.status} /> : <span className="text-[13px] text-text-muted">—</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Stage</span>
              <span className="text-[13px]">{stage?.stage_definition?.title ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">SOP</span>
              <span className="text-[13px] text-text-secondary">{issue.sop_snapshot?.title ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Created</span>
              <span className="text-[13px] text-text-secondary">{formatDate(issue.created_at)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Updated</span>
              <span className="text-[13px] text-text-secondary">{formatRelativeTime(issue.updated_at)}</span>
            </div>
          </div>
        </div>

        <div className="h-px bg-white/6" />

        {/* Stages */}
        <div>
          <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-3">Stages</div>
          <div className="space-y-2">
            {issue.stages.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors">
                <div className={`w-2 h-2 rounded-full ${s.status === "completed" ? "bg-status-green" : s.status === "in_progress" ? "bg-status-blue" : "bg-status-gray"}`} />
                <span className="text-[12px] text-text-secondary flex-1">{s.stage_definition?.title ?? s.type}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="h-px bg-white/6" />

        {/* Activity */}
        <div>
          <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-3">Activity</div>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-shell-600 flex items-center justify-center text-[9px] font-medium text-white mt-0.5 shrink-0">S</div>
              <div className="text-[12px] text-text-secondary">
                <span className="text-text-primary">System</span> created issue{" "}
                <span className="text-text-muted">{formatRelativeTime(issue.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
