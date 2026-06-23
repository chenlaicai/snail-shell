import type { IssueDetailDto } from "@/types";

export type IssueStatus = "active" | "closed";

export function getIssueStatus(issue: IssueDetailDto): IssueStatus {
  return issue.closed_at ? "closed" : "active";
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

export const statusColumns: { status: IssueStatus; label: string; dot: string }[] = [
  { status: "active", label: "In Progress", dot: "bg-status-blue" },
  { status: "closed", label: "Closed", dot: "bg-status-gray" },
];
