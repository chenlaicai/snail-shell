import { cn } from "../../lib/utils";

interface PriorityIndicatorProps {
  priority: "urgent" | "high" | "medium" | "low" | "none";
  className?: string;
}

const priorityConfig = {
  urgent: { label: "Urgent", color: "text-red-400", icon: "!!" },
  high: { label: "High", color: "text-orange-400", icon: "↑" },
  medium: { label: "Medium", color: "text-yellow-400", icon: "→" },
  low: { label: "Low", color: "text-blue-400", icon: "↓" },
  none: { label: "No priority", color: "text-gray-500", icon: "—" },
};

export function PriorityIndicator({ priority, className }: PriorityIndicatorProps) {
  const config = priorityConfig[priority];
  return (
    <span
      className={cn("inline-flex items-center justify-center w-4 text-[11px] font-bold", config.color, className)}
      title={config.label}
    >
      {config.icon}
    </span>
  );
}
