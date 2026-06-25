import type { IssueDetailDto, IssueStatus, ActivityStatus } from "@/types";

export function getIssueStatus(issue: IssueDetailDto): IssueStatus {
  return issue.closed_at ? "closed" : "active";
}

export function getIssueActivityStatus(issue: IssueDetailDto): ActivityStatus {
  return issue.activity_status;
}

/** Group issues by issue-level status (derived from closed_at). */
export function groupByStatus(issues: IssueDetailDto[]): Record<string, IssueDetailDto[]> {
  const groups: Record<string, IssueDetailDto[]> = {};
  for (const issue of issues) {
    const status = getIssueStatus(issue);
    if (!groups[status]) groups[status] = [];
    groups[status].push(issue);
  }
  return groups;
}

/** Group issues by activity status (ai_running / needs_human / completed). */
export function groupByActivityStatus(issues: IssueDetailDto[]): Record<ActivityStatus, IssueDetailDto[]> {
  const groups: Record<ActivityStatus, IssueDetailDto[]> = { ai_running: [], needs_human: [], completed: [] };
  for (const issue of issues) {
    const status = getIssueActivityStatus(issue);
    groups[status].push(issue);
  }
  return groups;
}

export const statusColumns: { status: IssueStatus; label: string; dot: string }[] = [
  { status: "active", label: "In Progress", dot: "bg-status-blue" },
  { status: "closed", label: "Closed", dot: "bg-status-gray" },
];

export const activityStatusColumns: { status: ActivityStatus; label: string; dot: string }[] = [
  { status: "ai_running", label: "AI Running", dot: "bg-status-blue" },
  { status: "needs_human", label: "Needs You", dot: "bg-status-amber" },
  { status: "completed", label: "Completed", dot: "bg-status-gray" },
];
