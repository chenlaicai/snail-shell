import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metaQueries } from "@/queries/meta.queries";
import { useCreateSnail, useUpdateSnail, useDeleteSnail } from "@/mutations/snail.mutations";
import { TopBar } from "@/components/TopBar";
import { SnailFormDialog } from "@/components/SnailFormDialog";
import { showToast } from "@/components/Toast";
import type { SnailDenTemplateDto } from "@api-contracts/dto";

export function SnailDen() {
  const { data: templates = [], isLoading } = useQuery(metaQueries.snailDen());
  const createMutation = useCreateSnail();
  const updateMutation = useUpdateSnail();
  const deleteMutation = useDeleteSnail();

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingSnail, setEditingSnail] = useState<SnailDenTemplateDto | undefined>();
  const [deletingSnail, setDeletingSnail] = useState<{ key: string; name: string } | null>(null);

  function handleCreate() {
    setFormMode("create");
    setEditingSnail(undefined);
    setFormOpen(true);
  }

  function handleEdit(snail: SnailDenTemplateDto) {
    setFormMode("edit");
    setEditingSnail(snail);
    setFormOpen(true);
  }

  function handleDelete(key: string, name: string) {
    setDeletingSnail({ key, name });
  }

  function confirmDelete() {
    if (!deletingSnail) return;
    deleteMutation.mutate(deletingSnail.key, {
      onSuccess: () => { showToast("删除成功"); setDeletingSnail(null); },
      onError: (err) => showToast(`删除失败：${err.message}`, true),
    });
  }

  function handleSubmit(data: SnailDenTemplateDto) {
    if (formMode === "create") {
      createMutation.mutate(data, {
        onSuccess: () => { showToast("创建成功"); setFormOpen(false); },
        onError: (err) => showToast(`创建失败：${err.message}`, true),
      });
    } else {
      updateMutation.mutate({ key: data.key, name: data.name, agent_name: data.agent_name, model: data.model, context_window: data.context_window, invocation_timeout_ms: data.invocation_timeout_ms }, {
        onSuccess: () => { showToast("更新成功"); setFormOpen(false); },
        onError: (err) => showToast(`更新失败：${err.message}`, true),
      });
    }
  }

  const isMutating = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Snail Den" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Snail Den</h1>
            <p className="mt-1 text-[13px] text-text-secondary">{templates.length} templates</p>
          </div>
          <button
            onClick={handleCreate}
            className="px-4 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-sm font-medium transition-colors"
          >
            Create Snail
          </button>
        </div>
        {templates.length === 0 ? (
          <div className="py-4 text-[13px] text-text-muted">还没有 Snail，点击新增创建第一个</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <div key={t.key} className="group rounded-lg border border-white/6 bg-surface-1 p-4 transition-colors hover:bg-surface-2">
                <div className="mb-2 flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-text-primary">{t.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-text-muted">{t.key}</span>
                </div>
                <div className="text-[12px] leading-5 text-text-secondary">
                  {t.agent_name} · {t.model}{t.context_window ? ` · ${Math.round(t.context_window / 1000)}K` : ""}
                </div>
                <div className="mt-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEdit(t)}
                    className="px-2.5 py-1 text-[11px] text-text-secondary hover:text-text-primary border border-white/6 rounded transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(t.key, t.name)}
                    className="px-2.5 py-1 text-[11px] text-status-red hover:text-status-red/80 border border-status-red/30 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <SnailFormDialog
        open={formOpen}
        mode={formMode}
        initialData={editingSnail}
        isPending={isMutating}
        onSubmit={handleSubmit}
        onClose={() => setFormOpen(false)}
      />
      {deletingSnail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 px-4" onClick={() => setDeletingSnail(null)}>
          <div role="dialog" aria-modal="true" className="bg-surface-2 border border-white/6 rounded-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-white/6">
              <h2 className="text-lg font-semibold">确认删除</h2>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-text-secondary">确定要删除 Snail <span className="font-medium text-text-primary">"{deletingSnail.name}"</span> 吗？删除后不可恢复。</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/6">
              <button type="button" onClick={() => setDeletingSnail(null)} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
                取消
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                className="px-4 py-1.5 rounded-md bg-status-red hover:bg-status-red/80 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
