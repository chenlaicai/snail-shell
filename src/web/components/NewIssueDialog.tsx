import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api-client";
import { queryKeys } from "@/queries/keys";
import { showToast } from "@/components/Toast";
import type { SopDto } from "@/types";

interface NewIssueDialogProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

export function NewIssueDialog({ workspaceId, open, onClose }: NewIssueDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [sopKey, setSopKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: sops = [] } = useQuery({
    queryKey: queryKeys.sops.all,
    queryFn: () => api("GET /api/sops", { query: { source: "platform" } }),
    enabled: open,
  });

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !sopKey || submitting) return;
    setSubmitting(true);
    try {
      await api("POST /api/workspaces/:workspaceId/issues", {
        params: { workspaceId },
        body: {
          title: title.trim(),
          summary: summary.trim() || undefined,
          adopted_sop_key: sopKey,
          snail_assignment_plan: {},
        },
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
      setTitle(""); setSummary(""); setSopKey(""); onClose();
    } catch (err: unknown) {
      showToast(`创建失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80" onClick={onClose}>
      <div className="bg-surface-2 border border-white/6 rounded-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">New Issue</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-text-muted mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40"
              placeholder="Issue title"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40 resize-none"
              placeholder="Optional description"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">SOP *</label>
            <select
              value={sopKey}
              onChange={(e) => setSopKey(e.target.value)}
              className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-shell-600/40"
            >
              <option value="">Select SOP...</option>
              {(Array.isArray(sops) ? sops : []).map((sop: SopDto) => (
                <option key={sop.key} value={sop.key}>{sop.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !sopKey || submitting}
              className="px-4 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
