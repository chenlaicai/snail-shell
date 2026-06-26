import { useEffect, useState } from "react";
import type { SopDto, RoleDefinitionDto } from "@api-contracts/dto";

const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface SopFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialData?: SopDto;
  isPending?: boolean;
  onSubmit: (data: SopDto) => void;
  onClose: () => void;
}

type StageDef = SopDto["stage_definitions"][number];
type Transition = SopDto["transitions"][number];

const emptyRole = (): RoleDefinitionDto => ({ key: "", name: "", description: "", is_primary: false, count: 1, skill: null, prohibition: null, self_check: null });
const emptyStage = (): StageDef => ({ key: "", title: "", description: "", roles: [emptyRole()] });
const emptyTransition = (): Transition => ({ from: "", to: "", guard: null });

export function SopFormDialog({ open, mode, initialData, isPending, onSubmit, onClose }: SopFormDialogProps) {
  const [key, setKey] = useState(initialData?.key ?? "");
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [sharedSkill, setSharedSkill] = useState(initialData?.shared_skill ?? "");
  const [stages, setStages] = useState<StageDef[]>(initialData?.stage_definitions ?? []);
  const [transitions, setTransitions] = useState<Transition[]>(initialData?.transitions ?? []);

  useEffect(() => {
    if (open && initialData) {
      setKey(initialData.key);
      setName(initialData.name);
      setDescription(initialData.description ?? "");
      setSharedSkill(initialData.shared_skill ?? "");
      setStages(initialData.stage_definitions);
      setTransitions(initialData.transitions);
    } else if (open && mode === "create") {
      setKey("");
      setName("");
      setDescription("");
      setSharedSkill("");
      setStages([]);
      setTransitions([]);
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

  function updateStage(idx: number, patch: Partial<StageDef>) {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function removeStage(idx: number) {
    setStages(prev => prev.filter((_, i) => i !== idx));
  }

  function updateRole(stageIdx: number, roleIdx: number, patch: Partial<RoleDefinitionDto>) {
    setStages(prev => prev.map((s, i) => i === stageIdx ? { ...s, roles: s.roles.map((r, j) => j === roleIdx ? { ...r, ...patch } : r) } : s));
  }

  function removeRole(stageIdx: number, roleIdx: number) {
    setStages(prev => prev.map((s, i) => i === stageIdx ? { ...s, roles: s.roles.filter((_, j) => j !== roleIdx) } : s));
  }

  function addRole(stageIdx: number) {
    setStages(prev => prev.map((s, i) => i === stageIdx ? { ...s, roles: [...s.roles, emptyRole()] } : s));
  }

  function updateTransition(idx: number, patch: Partial<Transition>) {
    setTransitions(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
  }

  function removeTransition(idx: number) {
    setTransitions(prev => prev.filter((_, i) => i !== idx));
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !name.trim()) return;
    if (keyInvalid) return;

    onSubmit({
      key: key.trim(),
      name: name.trim(),
      description: description.trim() || null,
      shared_skill: sharedSkill.trim() || null,
      scope: initialData?.scope ?? "platform",
      stage_definitions: stages.filter(s => s.key.trim() && s.title.trim()),
      transitions: transitions.filter(t => t.from.trim() && t.to.trim()),
    });
  };

  const inputCls = "w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="sop-form-title" className="bg-surface-2 border border-white/6 rounded-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/6 shrink-0">
          <h2 id="sop-form-title" className="text-lg font-semibold">{isCreate ? "Create SOP" : "Edit SOP"}</h2>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Key *</label>
              <input value={key} onChange={(e) => setKey(e.target.value)} disabled={!isCreate}
                className={`${inputCls} disabled:opacity-50 ${keyInvalid ? "border-status-red" : ""}`}
                placeholder="e.g. code-delivery" autoFocus={isCreate} />
              {keyInvalid && <p className="mt-1 text-[11px] text-status-red">Key must match [a-zA-Z0-9_-]+</p>}
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. 代码交付流程" autoFocus={!isCreate} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder="SOP 描述" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Shared Skill</label>
            <input value={sharedSkill} onChange={(e) => setSharedSkill(e.target.value)} className={inputCls} placeholder="e.g. cd-shared" />
          </div>

          {/* Stage Definitions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Stage 定义</label>
              <button type="button" onClick={() => setStages(prev => [...prev, emptyStage()])} className="text-xs text-shell-600 hover:text-shell-500">+ 添加 Stage</button>
            </div>
            {stages.length === 0 && <div className="py-3 text-[12px] text-text-muted">暂无 Stage 定义</div>}
            {stages.map((stage, si) => (
              <div key={si} className="mb-3 rounded-lg border border-white/6 bg-surface-1 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12px] font-medium text-text-muted">Stage #{si + 1}</span>
                  <button type="button" onClick={() => removeStage(si)} className="text-[11px] text-status-red hover:text-status-red/80">删除</button>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] text-text-muted mb-1">Key *</label>
                    <input value={stage.key} onChange={(e) => updateStage(si, { key: e.target.value })} className={inputCls} placeholder="e.g. design" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-text-muted mb-1">Title *</label>
                    <input value={stage.title} onChange={(e) => updateStage(si, { title: e.target.value })} className={inputCls} placeholder="e.g. 需求对齐与设计" />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-text-muted mb-1">Description</label>
                  <textarea value={stage.description} onChange={(e) => updateStage(si, { description: e.target.value })} className={`${inputCls} resize-none`} rows={2} />
                </div>

                {/* Roles */}
                <div className="ml-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-medium text-text-muted">Roles</label>
                    <button type="button" onClick={() => addRole(si)} className="text-[11px] text-shell-600 hover:text-shell-500">+ 添加 Role</button>
                  </div>
                  {stage.roles.map((role, ri) => (
                    <div key={ri} className="mb-2 rounded border border-white/4 bg-surface-0 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-text-muted">Role #{ri + 1}</span>
                        <button type="button" onClick={() => removeRole(si, ri)} className="text-[10px] text-status-red hover:text-status-red/80">删除</button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div>
                          <label className="block text-[10px] text-text-muted mb-0.5">Key *</label>
                          <input value={role.key ?? ""} onChange={(e) => updateRole(si, ri, { key: e.target.value })} className={inputCls + " text-xs py-1"} />
                        </div>
                        <div>
                          <label className="block text-[10px] text-text-muted mb-0.5">Name *</label>
                          <input value={role.name} onChange={(e) => updateRole(si, ri, { name: e.target.value })} className={inputCls + " text-xs py-1"} />
                        </div>
                        <div>
                          <label className="block text-[10px] text-text-muted mb-0.5">Skill</label>
                          <input value={role.skill ?? ""} onChange={(e) => updateRole(si, ri, { skill: e.target.value || null })} className={inputCls + " text-xs py-1"} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <label className="block text-[10px] text-text-muted mb-0.5">Description</label>
                          <input value={role.description ?? ""} onChange={(e) => updateRole(si, ri, { description: e.target.value })} className={inputCls + " text-xs py-1"} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-text-muted mb-0.5">Count</label>
                            <input type="number" min={1} value={role.count ?? 1} onChange={(e) => updateRole(si, ri, { count: parseInt(e.target.value) || 1 })} className={inputCls + " text-xs py-1"} />
                          </div>
                          <div className="flex items-end pb-1">
                            <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
                              <input type="checkbox" checked={role.is_primary ?? false} onChange={(e) => updateRole(si, ri, { is_primary: e.target.checked })} />
                              Primary
                            </label>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-text-muted mb-0.5">Prohibition</label>
                          <input value={role.prohibition ?? ""} onChange={(e) => updateRole(si, ri, { prohibition: e.target.value || null })} className={inputCls + " text-xs py-1"} />
                        </div>
                        <div>
                          <label className="block text-[10px] text-text-muted mb-0.5">Self Check</label>
                          <input value={role.self_check ?? ""} onChange={(e) => updateRole(si, ri, { self_check: e.target.value || null })} className={inputCls + " text-xs py-1"} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Transitions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Transitions</label>
              <button type="button" onClick={() => setTransitions(prev => [...prev, emptyTransition()])} className="text-xs text-shell-600 hover:text-shell-500">+ 添加 Transition</button>
            </div>
            {transitions.length === 0 && <div className="py-3 text-[12px] text-text-muted">暂无 Transitions</div>}
            {transitions.map((t, ti) => (
              <div key={ti} className="mb-2 flex items-center gap-2">
                <input value={t.from} onChange={(e) => updateTransition(ti, { from: e.target.value })} className={inputCls + " text-xs py-1 flex-1"} placeholder="from" />
                <span className="text-text-muted text-xs">→</span>
                <input value={t.to} onChange={(e) => updateTransition(ti, { to: e.target.value })} className={inputCls + " text-xs py-1 flex-1"} placeholder="to" />
                <input value={t.guard ?? ""} onChange={(e) => updateTransition(ti, { guard: e.target.value || null })} className={inputCls + " text-xs py-1 flex-1"} placeholder="guard (optional)" />
                <button type="button" onClick={() => removeTransition(ti)} className="text-[11px] text-status-red hover:text-status-red/80 shrink-0">删除</button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/6">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">Cancel</button>
            <button
              type="submit"
              disabled={!key.trim() || !name.trim() || keyInvalid || isPending}
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
