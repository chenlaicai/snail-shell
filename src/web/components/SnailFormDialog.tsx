import { useEffect, useState } from "react";
import type { SnailDenTemplateDto } from "@api-contracts/dto";

const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface SnailFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialData?: SnailDenTemplateDto;
  isPending?: boolean;
  onSubmit: (data: SnailDenTemplateDto) => void;
  onClose: () => void;
}

export function SnailFormDialog({ open, mode, initialData, isPending, onSubmit, onClose }: SnailFormDialogProps) {
  const [key, setKey] = useState(initialData?.key ?? "");
  const [name, setName] = useState(initialData?.name ?? "");
  const [agentName, setAgentName] = useState(initialData?.agent_name ?? "");
  const [model, setModel] = useState(initialData?.model ?? "");
  const [contextWindow, setContextWindow] = useState(initialData?.context_window?.toString() ?? "");
  const [invocationTimeoutMs, setInvocationTimeoutMs] = useState(initialData?.invocation_timeout_ms?.toString() ?? "");

  useEffect(() => {
    if (open && initialData) {
      setKey(initialData.key);
      setName(initialData.name);
      setAgentName(initialData.agent_name);
      setModel(initialData.model);
      setContextWindow(initialData.context_window?.toString() ?? "");
      setInvocationTimeoutMs(initialData.invocation_timeout_ms?.toString() ?? "");
    } else if (open && mode === "create") {
      setKey("");
      setName("");
      setAgentName("");
      setModel("");
      setContextWindow("");
      setInvocationTimeoutMs("");
    }
  }, [open, mode, initialData]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const keyInvalid = isCreate && key.trim().length > 0 && !KEY_PATTERN.test(key.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !name.trim() || !agentName.trim() || !model.trim()) return;
    if (keyInvalid) return;

    onSubmit({
      key: key.trim(),
      name: name.trim(),
      agent_name: agentName.trim(),
      model: model.trim(),
      context_window: contextWindow ? parseInt(contextWindow, 10) : undefined,
      invocation_timeout_ms: invocationTimeoutMs ? parseInt(invocationTimeoutMs, 10) : undefined,
    });
  };

  const isCreate = mode === "create";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="snail-form-title" className="bg-surface-2 border border-white/6 rounded-xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/6">
          <h2 id="snail-form-title" className="text-lg font-semibold">{isCreate ? "Create Snail" : "Edit Snail"}</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-text-muted mb-1">Key *</label>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={!isCreate}
              className={`w-full bg-surface-0 border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50 ${keyInvalid ? "border-status-red focus:border-status-red" : "border-white/6 focus:border-shell-600/40"}`}
              placeholder="e.g. claude-code-sonnet"
              autoFocus={isCreate}
            />
            {keyInvalid && <p className="mt-1 text-[11px] text-status-red">Key must match pattern [a-zA-Z0-9_-]+</p>}
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40"
              placeholder="e.g. Claude Code + Sonnet"
              autoFocus={!isCreate}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Agent Name *</label>
            <input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40"
              placeholder="e.g. claude-code"
            />
            <p className="mt-1 text-[11px] text-text-muted">此 agent_name 将在运行时验证，未注册的 agent 调用时可能失败</p>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Model *</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40"
              placeholder="e.g. sonnet"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Context Window</label>
            <input
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
              type="number"
              min="0"
              step="1"
              className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40"
              placeholder="e.g. 200000"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Invocation Timeout (ms)</label>
            <input
              value={invocationTimeoutMs}
              onChange={(e) => setInvocationTimeoutMs(e.target.value)}
              type="number"
              min="0"
              step="1"
              className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40"
              placeholder="e.g. 7200000"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!key.trim() || !name.trim() || !agentName.trim() || !model.trim() || keyInvalid || isPending}
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
