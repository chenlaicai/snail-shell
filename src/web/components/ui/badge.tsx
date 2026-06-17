import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = {
  variant: {
    default: "border-transparent bg-shell-600/20 text-shell-400",
    secondary: "border-transparent bg-surface-3 text-text-secondary",
    destructive: "border-transparent bg-status-red/15 text-status-red",
    outline: "border-white/10 text-text-muted",
  },
};

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof badgeVariants.variant;
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors focus:outline-none",
        badgeVariants.variant[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
