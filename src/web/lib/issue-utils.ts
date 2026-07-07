import type { IssueDetailDto, ActivityStatus } from "@/types";

/** Group issues by activity status (snail_running / needs_human / completed). */
export function groupByActivityStatus(issues: IssueDetailDto[]): Record<ActivityStatus, IssueDetailDto[]> {
  const groups: Record<ActivityStatus, IssueDetailDto[]> = { snail_running: [], needs_human: [], completed: [] };
  for (const issue of issues) {
    groups[issue.activity_status].push(issue);
  }
  return groups;
}

export const activityStatusColumns: { status: ActivityStatus; label: string; dot: string }[] = [
  { status: "snail_running", label: "Snail Running", dot: "bg-status-blue" },
  { status: "needs_human", label: "Needs You", dot: "bg-status-amber" },
  { status: "completed", label: "Completed", dot: "bg-status-gray" },
];
