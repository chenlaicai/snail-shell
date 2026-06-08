import { cn } from "../../lib/utils";

const statusConfig = {
  backlog: { label: "Backlog", color: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
  todo: { label: "Todo", color: "bg-slate-500/20 text-slate-300 border-slate-500/30" },
  in_progress: { label: "In Progress", color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" },
  done: { label: "Done", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  cancelled: { label: "Cancelled", color: "bg-red-500/20 text-red-400 border-red-500/30" },
} as const;

export type IssueStatus = keyof typeof statusConfig;

interface StatusBadgeProps {
  status: IssueStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
        config.color,
        className
      )}
    >
      <StatusDot status={status} />
      {config.label}
    </span>
  );
}

export function StatusDot({ status }: { status: IssueStatus }) {
  const dotColor = {
    backlog: "bg-gray-500",
    todo: "bg-slate-400",
    in_progress: "bg-indigo-400",
    done: "bg-emerald-400",
    cancelled: "bg-red-400",
  } as const;

  return <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[status])} />;
}
