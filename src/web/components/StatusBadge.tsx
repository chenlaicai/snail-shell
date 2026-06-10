import type { StageStatus } from "@/types";

const statusConfig: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  in_progress: { label: "In Progress", dot: "bg-status-blue", bg: "bg-status-blue/15", text: "text-status-blue" },
  completed: { label: "Done", dot: "bg-status-green", bg: "bg-status-green/15", text: "text-status-green" },
  cancelled: { label: "Cancelled", dot: "bg-status-gray", bg: "bg-white/6", text: "text-text-muted" },
};

export function StatusBadge({ status }: { status: StageStatus }) {
  const c = statusConfig[status] ?? statusConfig.cancelled;
  return (
    <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium ${c.bg} ${c.text}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
