import { useQuery } from "@tanstack/react-query";
import { scheduledTaskQueries } from "@/queries/scheduled-task.queries";
import type { ScheduledTaskDto, ScheduledTaskExecutionDto } from "@/types";

interface ScheduledTaskDetailProps {
  task: ScheduledTaskDto;
}

export function ScheduledTaskDetail({ task }: ScheduledTaskDetailProps) {
  const { data: executions = [] } = useQuery(scheduledTaskQueries.executions(task.id));

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">{task.title}</h1>
        <div className="mt-1 font-mono text-[11px] text-text-muted">{task.key}</div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <InfoRow label="SOP" value={task.sop_key} />
        <InfoRow label="Workspace" value={task.workspace_path} />
        <InfoRow label="Interval" value={`Every ${task.interval_days} day${task.interval_days > 1 ? "s" : ""}`} />
        <InfoRow label="Status" value={task.enabled ? "Enabled" : "Disabled"} />
        <InfoRow label="Created" value={formatTime(task.created_at)} />
        <InfoRow label="Last Execution" value={task.last_status ? `${task.last_status}` : "Never"} />
      </div>

      {task.last_issue_id && (
        <div className="mb-6 text-[12px]">
          <span className="text-text-muted">Last Issue: </span>
          <a href={`/workspaces/${encodeURIComponent(task.workspace_path)}/issue/${task.last_issue_id}`}
            className="text-shell-500 hover:text-shell-400 font-mono">{task.last_issue_id.slice(0, 8)}</a>
        </div>
      )}

      <h2 className="mb-3 text-sm font-medium text-text-primary">Execution History</h2>
      {executions.length === 0 ? (
        <div className="py-3 text-[13px] text-text-muted">No executions yet</div>
      ) : (
        <div className="rounded-lg border border-white/6 overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface-1 text-text-muted">
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Issue</th>
                <th className="text-left px-3 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((exec) => (
                <tr key={exec.id} className="border-t border-white/4">
                  <td className="px-3 py-2 text-text-secondary font-mono">{formatTime(exec.executed_at)}</td>
                  <td className="px-3 py-2"><StatusBadge status={exec.status} /></td>
                  <td className="px-3 py-2">
                    {exec.issue_id ? (
                      <a href={`/workspaces/${encodeURIComponent(task.workspace_path)}/issue/${exec.issue_id}`}
                        className="text-shell-500 hover:text-shell-400 font-mono">{exec.issue_id.slice(0, 8)}</a>
                    ) : <span className="text-text-muted">-</span>}
                  </td>
                  <td className="px-3 py-2 text-status-red max-w-xs truncate">{exec.error ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-text-muted mb-0.5">{label}</div>
      <div className="text-[13px] text-text-primary">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: ScheduledTaskExecutionDto["status"] }) {
  const cls = status === "success" ? "bg-status-green/15 text-status-green"
    : status === "failed" ? "bg-status-red/15 text-status-red"
    : "bg-white/10 text-text-muted";
  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>{status}</span>;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
