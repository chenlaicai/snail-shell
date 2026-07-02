import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { scheduledTaskQueries } from "@/queries/scheduled-task.queries";
import { useCreateScheduledTask, useUpdateScheduledTask, useDeleteScheduledTask } from "@/mutations/scheduled-task.mutations";
import { showToast } from "@/components/Toast";
import { TopBar } from "@/components/TopBar";
import { ScheduledTaskFormDialog } from "@/components/ScheduledTaskFormDialog";
import { ScheduledTaskDetail } from "@/components/ScheduledTaskDetail";
import type { ScheduledTaskDto, CreateScheduledTaskBody } from "@/types";

export function ScheduledTasks() {
  const { data: tasks = [], isLoading } = useQuery(scheduledTaskQueries.list());
  const createMutation = useCreateScheduledTask();
  const updateMutation = useUpdateScheduledTask();
  const deleteMutation = useDeleteScheduledTask();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingTask, setEditingTask] = useState<ScheduledTaskDto | undefined>();
  const [deletingTask, setDeletingTask] = useState<{ id: string; title: string } | null>(null);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  function handleCreate() {
    setFormMode("create");
    setEditingTask(undefined);
    setFormOpen(true);
  }

  function handleEdit(task: ScheduledTaskDto) {
    setFormMode("edit");
    setEditingTask(task);
    setFormOpen(true);
  }

  function handleDelete(id: string, title: string) {
    setDeletingTask({ id, title });
  }

  function confirmDelete() {
    if (!deletingTask) return;
    deleteMutation.mutate(deletingTask.id, {
      onSuccess: () => {
        showToast("删除成功");
        setDeletingTask(null);
        if (selectedId === deletingTask.id) {
          setSelectedId(null);
        }
      },
      onError: (err) => showToast(`删除失败：${err.message}`, true),
    });
  }

  function handleSubmit(data: CreateScheduledTaskBody) {
    if (formMode === "create") {
      createMutation.mutate(data, {
        onSuccess: () => { showToast("创建成功"); setFormOpen(false); },
        onError: (err) => showToast(`创建失败：${err.message}`, true),
      });
    } else if (editingTask) {
      updateMutation.mutate({ id: editingTask.id, ...data }, {
        onSuccess: () => { showToast("更新成功"); setFormOpen(false); },
        onError: (err) => showToast(`更新失败：${err.message}`, true),
      });
    }
  }

  function handleToggleEnabled(task: ScheduledTaskDto) {
    updateMutation.mutate({ id: task.id, enabled: !task.enabled }, {
      onSuccess: () => showToast(task.enabled ? "已禁用" : "已启用"),
      onError: (err) => showToast(`操作失败：${err.message}`, true),
    });
  }

  const isMutating = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Scheduled Tasks" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">Tasks</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-muted">{tasks.length}</span>
              <button onClick={handleCreate} className="px-2 py-0.5 rounded text-[11px] bg-shell-600 hover:bg-shell-500 text-white transition-colors">+</button>
            </div>
          </div>
          {tasks.length === 0 ? (
            <div className="py-3 text-[13px] text-text-muted">暂无定时任务</div>
          ) : tasks.map((task) => (
            <div key={task.id} className="group mb-1 relative">
              <button onClick={() => setSelectedId(task.id)} className={`w-full rounded-lg p-3 text-left transition-colors ${selectedId === task.id ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary"}`}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{task.title}</span>
                  <span className={`inline-block w-2 h-2 rounded-full ${task.enabled ? "bg-status-green" : "bg-white/20"}`} />
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                  <span>每 {task.interval_days} 天</span>
                  {task.last_status && <ExecutionStatusBadge status={task.last_status} />}
                </div>
              </button>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleToggleEnabled(task)} className="px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary border border-white/6 rounded transition-colors">
                  {task.enabled ? "Disable" : "Enable"}
                </button>
                <button onClick={() => handleEdit(task)} className="px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary border border-white/6 rounded transition-colors">Edit</button>
                <button onClick={() => handleDelete(task.id, task.title)} className="px-1.5 py-0.5 text-[10px] text-status-red hover:text-status-red/80 border border-status-red/30 rounded transition-colors">Del</button>
              </div>
            </div>
          ))}
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {selectedTask ? (
            <ScheduledTaskDetail task={selectedTask} />
          ) : (
            <div className="py-3 text-[13px] text-text-muted">选择一个定时任务查看详情</div>
          )}
        </main>
      </div>

      <ScheduledTaskFormDialog
        open={formOpen}
        mode={formMode}
        initialData={editingTask}
        isPending={isMutating}
        onSubmit={handleSubmit}
        onClose={() => setFormOpen(false)}
      />

      {deletingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 px-4" onClick={() => setDeletingTask(null)}>
          <div role="dialog" aria-modal="true" className="bg-surface-2 border border-white/6 rounded-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-white/6">
              <h2 className="text-lg font-semibold">确认删除</h2>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-text-secondary">确定要删除定时任务 <span className="font-medium text-text-primary">"{deletingTask.title}"</span> 吗？删除后不可恢复。</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/6">
              <button type="button" onClick={() => setDeletingTask(null)} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">取消</button>
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

function ExecutionStatusBadge({ status }: { status: "pending" | "success" | "failed" }) {
  const cls = status === "success" ? "bg-status-green/15 text-status-green"
    : status === "failed" ? "bg-status-red/15 text-status-red"
    : "bg-white/10 text-text-muted";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{status}</span>;
}
