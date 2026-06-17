import type { IssueDetailDto, StageStatus } from "@/types";

/** Group issues by stage status. Every issue is expected to have a current stage. */
export function groupByStatus(issues: IssueDetailDto[]): Record<string, IssueDetailDto[]> {
  const groups: Record<string, IssueDetailDto[]> = {};
  for (const issue of issues) {
    const status = issue.current_stage.status;
    if (!groups[status]) groups[status] = [];
    groups[status].push(issue);
  }
  return groups;
}

export const statusColumns: { status: StageStatus; label: string; dot: string }[] = [
  { status: "in_progress", label: "In Progress", dot: "bg-status-blue" },
  { status: "completed", label: "Done", dot: "bg-status-green" },
];
