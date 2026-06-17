import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateWorkspace } from "@/mutations/workspace.mutations";
import { TopBar } from "@/components/TopBar";
import { showToast } from "@/components/Toast";

export function WorkspaceConfig() {
  const navigate = useNavigate();
  const createWorkspace = useCreateWorkspace();
  const [path, setPath] = useState("");
  const [summary, setSummary] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) { showToast("Workspace path 不能为空", true); return; }
    createWorkspace.mutate(
      { path: trimmed, summary: summary.trim() || undefined },
      {
        onSuccess: (workspace) => navigate(`/workspaces/${workspace.id}/board`),
        onError: (err) => showToast(`创建 Workspace 失败：${err instanceof Error ? err.message : String(err)}`, true),
      },
    );
  }

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Workspaces", to: "/workspaces" }, { label: "New" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-text-primary">New Workspace</h1>
            <p className="mt-1 text-[13px] text-text-secondary">Create a workspace root for issue collaboration.</p>
          </div>

          <form onSubmit={handleSubmit} className="rounded-xl border border-white/6 bg-surface-1 p-5">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">Path *</label>
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/path/to/workspace"
                  className="w-full rounded-md border border-white/6 bg-surface-0 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-shell-600/40 focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">Summary</label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Optional workspace description"
                  rows={3}
                  className="w-full resize-none rounded-md border border-white/6 bg-surface-0 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-shell-600/40 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-white/6 pt-4">
              <button
                type="button"
                onClick={() => navigate("/workspaces")}
                className="rounded-md px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!path.trim() || createWorkspace.isPending}
                className="rounded-md bg-shell-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-shell-500 disabled:opacity-50"
              >
                {createWorkspace.isPending ? "Creating..." : "Create Workspace"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
