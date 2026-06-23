import type { IssueDetailDto } from "@/types";

/** 推导 issue 级别的显示状态：archived_at > closed_at > stage.status */
export function deriveIssueStatus(issue: IssueDetailDto): string {
  if (issue.archived_at) return "archived";
  if (issue.closed_at) return "completed";
  return issue.current_stage.status;
}

/** Group issues by derived status. Archived issues are grouped separately. */
export function groupByStatus(issues: IssueDetailDto[]): Record<string, IssueDetailDto[]> {
  const groups: Record<string, IssueDetailDto[]> = {};
  for (const issue of issues) {
    const status = deriveIssueStatus(issue);
    if (!groups[status]) groups[status] = [];
    groups[status].push(issue);
  }
  return groups;
}

export const statusColumns: { status: string; label: string; dot: string }[] = [
  { status: "in_progress", label: "In Progress", dot: "bg-status-blue" },
  { status: "completed", label: "Done", dot: "bg-status-green" },
  { status: "archived", label: "Archived", dot: "bg-status-gray" },
];
