import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api-client";
import { sopQueries } from "@/queries/sop.queries";
import { useCreateSop, useUpdateSop, useDeleteSop } from "@/mutations/sop.mutations";
import { showToast } from "@/components/Toast";
import { Badge } from "@/components/ui/badge";
import { TopBar } from "@/components/TopBar";
import { SopFormDialog } from "@/components/SopFormDialog";
import type { SopDetailDto, SopDto } from "@/types";

export function SopCenter() {
  const { data: sops = [], isLoading } = useQuery(sopQueries.list());
  const createMutation = useCreateSop();
  const updateMutation = useUpdateSop();
  const deleteMutation = useDeleteSop();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<SopDetailDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingSop, setEditingSop] = useState<SopDto | undefined>();
  const [deletingSop, setDeletingSop] = useState<{ key: string; name: string } | null>(null);

  async function selectSop(sopKey: string) {
    setSelectedKey(sopKey);
    try {
      setDetail(await api("GET /api/sops/:sopKey", { params: { sopKey } }));
    } catch (err: unknown) {
      showToast(`加载 SOP 详情失败：${err instanceof Error ? err.message : String(err)}`, true);
      setDetail(null);
    }
  }

  function handleCreate() {
    setFormMode("create");
    setEditingSop(undefined);
    setFormOpen(true);
  }

  function handleEdit(sop: SopDto) {
    setFormMode("edit");
    setEditingSop(sop);
    setFormOpen(true);
  }

  function handleDelete(key: string, name: string) {
    setDeletingSop({ key, name });
  }

  function confirmDelete() {
    if (!deletingSop) return;
    deleteMutation.mutate(deletingSop.key, {
      onSuccess: () => {
        showToast("删除成功");
        setDeletingSop(null);
        if (selectedKey === deletingSop.key) {
          setSelectedKey(null);
          setDetail(null);
        }
      },
      onError: (err) => showToast(`删除失败：${err.message}`, true),
    });
  }

  function handleSubmit(data: SopDto) {
    if (formMode === "create") {
      createMutation.mutate(data, {
        onSuccess: () => { showToast("创建成功"); setFormOpen(false); },
        onError: (err) => showToast(`创建失败：${err.message}`, true),
      });
    } else {
      updateMutation.mutate({ sopKey: data.key, name: data.name, description: data.description, shared_skill: data.shared_skill, stage_definitions: data.stage_definitions, transitions: data.transitions }, {
        onSuccess: () => {
          showToast("更新成功");
          setFormOpen(false);
          if (selectedKey === data.key) selectSop(data.key);
        },
        onError: (err) => showToast(`更新失败：${err.message}`, true),
      });
    }
  }

  const isMutating = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "SOP Center" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">SOPs</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-muted">{sops.length}</span>
              <button onClick={handleCreate} className="px-2 py-0.5 rounded text-[11px] bg-shell-600 hover:bg-shell-500 text-white transition-colors">+</button>
            </div>
          </div>
          {sops.length === 0 ? <div className="py-3 text-[13px] text-text-muted">暂无 SOP</div> : sops.map((sop) => (
            <div key={sop.key} className="group mb-1 relative">
              <button onClick={() => selectSop(sop.key)} className={`w-full rounded-lg p-3 text-left transition-colors ${selectedKey === sop.key ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary"}`}>
                <div className="text-[13px] font-medium">{sop.name}</div>
                <div className="mt-1 font-mono text-[10px] text-text-muted">{sop.scope} · {sop.key}</div>
              </button>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleEdit(sop)} className="px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary border border-white/6 rounded transition-colors">Edit</button>
                <button onClick={() => handleDelete(sop.key, sop.name)} className="px-1.5 py-0.5 text-[10px] text-status-red hover:text-status-red/80 border border-status-red/30 rounded transition-colors">Del</button>
              </div>
            </div>
          ))}
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {detail ? (
            <div className="max-w-4xl">
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h1 className="text-xl font-semibold text-text-primary">{detail.name}</h1>
                  <div className="mt-1 font-mono text-[11px] text-text-muted">{detail.scope} · {detail.key}</div>
                </div>
                <button onClick={() => handleEdit(detail)} className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary border border-white/6 rounded transition-colors">Edit</button>
              </div>
              {detail.description && <p className="mb-6 text-[13px] leading-6 text-text-secondary">{detail.description}</p>}
              {detail.shared_skill && <div className="mb-4 text-[12px] text-text-muted">Shared Skill: <Badge variant="outline">{detail.shared_skill}</Badge></div>}
              <h2 className="mb-3 text-sm font-medium text-text-primary">阶段定义</h2>
              {detail.stage_definitions.length > 0 ? (
                <div className="grid gap-3">
                  {detail.stage_definitions.map((stage) => (
                    <div key={stage.key} className="rounded-lg border border-white/6 bg-surface-1 p-4">
                      <div className="mb-2 flex items-center gap-2"><span className="text-[13px] font-medium text-text-primary">{stage.title}</span><Badge variant="outline">{stage.key}</Badge></div>
                      {stage.description && <div className="text-[12px] leading-5 text-text-muted">{stage.description}</div>}
                      {stage.roles.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{stage.roles.map((role) => <Badge key={role.key ?? role.name} variant={role.is_primary ? "default" : "secondary"}>{role.name}{role.is_primary ? " 主" : ""}</Badge>)}</div>}
                    </div>
                  ))}
                </div>
              ) : <div className="py-3 text-[13px] text-text-muted">暂无阶段定义</div>}
              {detail.transitions.length > 0 && (
                <>
                  <h2 className="mt-6 mb-3 text-sm font-medium text-text-primary">Transitions</h2>
                  <div className="grid gap-1">
                    {detail.transitions.map((t, i) => (
                      <div key={i} className="text-[12px] text-text-secondary font-mono">{t.from} → {t.to}{t.guard ? ` (${t.guard})` : ""}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : <div className="py-3 text-[13px] text-text-muted">选择一个 SOP 查看详情</div>}
        </main>
      </div>
      <SopFormDialog
        open={formOpen}
        mode={formMode}
        initialData={editingSop}
        isPending={isMutating}
        onSubmit={handleSubmit}
        onClose={() => setFormOpen(false)}
      />
      {deletingSop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 px-4" onClick={() => setDeletingSop(null)}>
          <div role="dialog" aria-modal="true" className="bg-surface-2 border border-white/6 rounded-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-white/6">
              <h2 className="text-lg font-semibold">确认删除</h2>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-text-secondary">确定要删除 SOP <span className="font-medium text-text-primary">"{deletingSop.name}"</span> 吗？删除后不可恢复。</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/6">
              <button type="button" onClick={() => setDeletingSop(null)} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">取消</button>
              <button type="button" onClick={confirmDelete} disabled={deleteMutation.isPending} className="px-4 py-1.5 rounded-md bg-status-red hover:bg-status-red/80 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {deleteMutation.isPending ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
