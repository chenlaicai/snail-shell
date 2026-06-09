import { useState } from "react";
import { useCreateIssue } from "@/mutations/issue.mutations";
import { useQuery } from "@tanstack/react-query";
import { sopQueries } from "@/queries/sop.queries";

interface NewIssueDialogProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

export function NewIssueDialog({ workspaceId, open, onClose }: NewIssueDialogProps) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [sopId, setSopId] = useState("");
  const createIssue = useCreateIssue(workspaceId);
  const { data: sops } = useQuery({ ...sopQueries.all(), enabled: open });

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createIssue.mutate(
      { title: title.trim(), summary: summary.trim() || undefined, adopted_sop_id: sopId || undefined },
      { onSuccess: () => { setTitle(""); setSummary(""); setSopId(""); onClose(); } },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
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
            <label className="block text-xs text-text-muted mb-1">SOP</label>
            <select
              value={sopId}
              onChange={(e) => setSopId(e.target.value)}
              className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-shell-600/40"
            >
              <option value="">Select SOP...</option>
              {sops?.map((sop) => (
                <option key={sop.id} value={sop.id}>{sop.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || createIssue.isPending}
              className="px-4 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {createIssue.isPending ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
