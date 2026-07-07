import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { issueTemplateQueries } from "@/queries/issue-template.queries";
import { useToggleIssueTemplate, useDeleteIssueTemplate } from "@/mutations/issue-template.mutations";
import { Badge } from "@/components/ui/badge";
import type { IssueTemplateDto } from "@/types";

interface IssueTemplateDetailProps {
  template: IssueTemplateDto;
  onEdit: () => void;
}

export function IssueTemplateDetail({ template, onEdit }: IssueTemplateDetailProps) {
  const { data: executions = [] } = useQuery(issueTemplateQueries.executions(template.id));
  const { data: children = [] } = useQuery(issueTemplateQueries.children(template.id));
  const toggleMutation = useToggleIssueTemplate();
  const deleteMutation = useDeleteIssueTemplate();

  function handleDelete() {
    if (!confirm(`Delete template "${template.title}"? Execution records will be cascade-deleted.`)) return;
    deleteMutation.mutate(template.id);
  }

  return (
    <div className="space-y-6">
      {/* Config info */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-text-primary">{template.title}</h2>
          <div className="flex gap-2">
            <button onClick={onEdit} className="px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary border border-white/6 rounded-md transition-colors">
              Edit
            </button>
            <button
              onClick={() => toggleMutation.mutate(template.id)}
              className="px-3 py-1.5 text-[13px] border border-white/6 rounded-md transition-colors"
            >
              {template.enabled ? "Disable" : "Enable"}
            </button>
            <button onClick={handleDelete} className="px-3 py-1.5 text-[13px] text-status-red hover:bg-status-red/10 border border-status-red/30 rounded-md transition-colors">
              Delete
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/6 bg-surface-1 p-4 space-y-2">
          <div className="grid grid-cols-[120px_1fr] gap-2 text-[13px]">
            <span className="text-text-muted">SOP</span>
            <span className="text-text-secondary">{template.sop_snapshot.name} ({template.sop_key})</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 text-[13px]">
            <span className="text-text-muted">Workspace</span>
            <span className="text-text-secondary font-mono text-[12px]">{template.workspace_path}</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 text-[13px]">
            <span className="text-text-muted">Cron</span>
            <span className="text-text-secondary font-mono">{template.cron_expression}</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 text-[13px]">
            <span className="text-text-muted">Snail Plan</span>
            <div className="space-y-1">
              {Object.entries(template.snail_assignment_plan).map(([stageId, roles]) => (
                <div key={stageId}>
                  <span className="text-text-muted text-[12px]">{stageId}:</span>
                  {Object.entries(roles).map(([role, snail]) => (
                    <span key={role} className="ml-2 text-[12px] text-text-secondary">
                      {role} → {snail}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 text-[13px]">
            <span className="text-text-muted">Status</span>
            <span className="flex items-center gap-2">
              <Badge variant={template.enabled ? "success" : "outline"}>{template.enabled ? "Enabled" : "Disabled"}</Badge>
              {template.consecutive_failures > 0 && (
                <span className="text-[11px] text-status-red">Failures: {template.consecutive_failures}</span>
              )}
            </span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 text-[13px]">
            <span className="text-text-muted">Last spawned</span>
            <span className="text-text-secondary">{template.last_spawned_at ? new Date(template.last_spawned_at).toLocaleString() : "Never"}</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 text-[13px]">
            <span className="text-text-muted">Created</span>
            <span className="text-text-secondary">{new Date(template.created_at).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Execution history */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-2">Execution History</h3>
        {executions.length === 0 ? (
          <div className="text-[13px] text-text-muted py-2">No executions yet.</div>
        ) : (
          <div className="rounded-lg border border-white/6 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-1 text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Time</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Child Issue</th>
                  <th className="px-3 py-2 text-left font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((exec) => (
                  <tr key={exec.id} className="border-t border-white/6">
                    <td className="px-3 py-2 text-text-secondary">{new Date(exec.executed_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <Badge variant={exec.status === "success" ? "success" : "destructive"}>{exec.status}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {exec.child_issue_id ? (
                        <Link to={`/workspaces/${template.workspace_id}/issue/${exec.child_issue_id}`} className="text-shell-400 hover:text-shell-300 font-mono text-[12px]">
                          {exec.child_issue_id.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-status-red text-[12px] max-w-xs truncate">{exec.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Children */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-2">Child Issues</h3>
        {children.length === 0 ? (
          <div className="text-[13px] text-text-muted py-2">No child issues created yet.</div>
        ) : (
          <div className="rounded-lg border border-white/6 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-1 text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Title</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {children.map((child) => (
                  <tr key={child.child_issue_id} className="border-t border-white/6">
                    <td className="px-3 py-2">
                      <Link to={`/workspaces/${child.workspace_id}/issue/${child.child_issue_id}`} className="text-shell-400 hover:text-shell-300">
                        {child.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={child.status === "open" ? "success" : "outline"}>{child.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{new Date(child.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
