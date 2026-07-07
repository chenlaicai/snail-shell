import type { StageStatus, ActivityStatus } from "@/types";

const statusConfig: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  in_progress: { label: "In Progress", dot: "bg-status-blue", bg: "bg-status-blue/15", text: "text-status-blue" },
  completed: { label: "Completed", dot: "bg-status-gray", bg: "bg-status-gray/15", text: "text-text-muted" },
  active: { label: "In Progress", dot: "bg-status-blue", bg: "bg-status-blue/15", text: "text-status-blue" },
  closed: { label: "Closed", dot: "bg-status-gray", bg: "bg-status-gray/15", text: "text-text-muted" },
  snail_running: { label: "Snail Running", dot: "bg-status-blue", bg: "bg-status-blue/15", text: "text-status-blue" },
  needs_human: { label: "Needs You", dot: "bg-status-amber", bg: "bg-status-amber/15", text: "text-status-amber" },
};

export function StatusBadge({ status }: { status: StageStatus | ActivityStatus }) {
  const c = statusConfig[status] ?? { label: status, dot: "bg-status-gray", bg: "bg-white/6", text: "text-text-muted" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium ${c.bg} ${c.text}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
