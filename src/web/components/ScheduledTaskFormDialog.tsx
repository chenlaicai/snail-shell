import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sopQueries } from "@/queries/sop.queries";
import { workspaceQueries } from "@/queries/workspace.queries";
import type { ScheduledTaskDto, CreateScheduledTaskBody } from "@/types";

const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface ScheduledTaskFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialData?: ScheduledTaskDto;
  isPending?: boolean;
  onSubmit: (data: CreateScheduledTaskBody) => void;
  onClose: () => void;
}

export function ScheduledTaskFormDialog({ open, mode, initialData, isPending, onSubmit, onClose }: ScheduledTaskFormDialogProps) {
  const { data: sops = [] } = useQuery({ ...sopQueries.list(), enabled: open });
  const { data: workspaces = [] } = useQuery({ ...workspaceQueries.list(), enabled: open });

  const [key, setKey] = useState(initialData?.key ?? "");
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [sopKey, setSopKey] = useState(initialData?.sop_key ?? "");
  const [workspacePath, setWorkspacePath] = useState(initialData?.workspace_path ?? "");
  const [intervalDays, setIntervalDays] = useState(initialData?.interval_days ?? 7);
  const [enabled, setEnabled] = useState(initialData?.enabled ?? true);

  useEffect(() => {
    if (open && initialData) {
      setKey(initialData.key);
      setTitle(initialData.title);
      setSopKey(initialData.sop_key);
      setWorkspacePath(initialData.workspace_path);
      setIntervalDays(initialData.interval_days);
      setEnabled(initialData.enabled);
    } else if (open && mode === "create") {
      setKey("");
      setTitle("");
      setSopKey("");
      setWorkspacePath("");
      setIntervalDays(7);
      setEnabled(true);
    }
  }, [open, mode, initialData]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isCreate = mode === "create";
  const keyInvalid = isCreate && key.trim().length > 0 && !KEY_PATTERN.test(key.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !title.trim() || !sopKey || !workspacePath || intervalDays <= 0) return;
    if (keyInvalid) return;

    onSubmit({
      key: key.trim(),
      title: title.trim(),
      sop_key: sopKey,
      workspace_path: workspacePath,
      interval_days: intervalDays,
      enabled,
    });
  };

  const inputCls = "w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="task-form-title" className="bg-surface-2 border border-white/6 rounded-xl w-full max-w-lg overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/6 shrink-0">
          <h2 id="task-form-title" className="text-lg font-semibold">{isCreate ? "Create Scheduled Task" : "Edit Scheduled Task"}</h2>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Key *</label>
              <input value={key} onChange={(e) => setKey(e.target.value)} disabled={!isCreate}
                className={`${inputCls} disabled:opacity-50 ${keyInvalid ? "border-status-red" : ""}`}
                placeholder="e.g. code-quality-check" autoFocus={isCreate} />
              {keyInvalid && <p className="mt-1 text-[11px] text-status-red">Key must match [a-zA-Z0-9_-]+</p>}
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. 代码质量看护" autoFocus={!isCreate} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">SOP *</label>
            <select value={sopKey} onChange={(e) => setSopKey(e.target.value)} className={inputCls}>
              <option value="">选择 SOP</option>
              {sops.map((sop) => (
                <option key={sop.key} value={sop.key}>{sop.name} ({sop.key})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Workspace *</label>
            <select value={workspacePath} onChange={(e) => setWorkspacePath(e.target.value)} className={inputCls}>
              <option value="">选择 Workspace</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.path}>{ws.path}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Interval (days) *</label>
              <input type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(parseInt(e.target.value) || 1)} className={inputCls} />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Enabled
              </label>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/6">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">Cancel</button>
            <button
              type="submit"
              disabled={!key.trim() || !title.trim() || !sopKey || !workspacePath || intervalDays <= 0 || keyInvalid || isPending}
              className="px-4 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isPending ? "Saving..." : isCreate ? "Create" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
