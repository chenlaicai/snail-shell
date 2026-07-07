import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/services/api-client";
import { evolutionQueries } from "@/queries/evolution.queries";
import { useCreateIssueFromItem, useCloseEvolutionItem } from "@/mutations/evolution.mutations";
import { showToast } from "@/components/Toast";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { TopBar } from "@/components/TopBar";
import type { EvolutionItemDto } from "@/types";

const STATUS_LABELS: Record<string, string> = {
  candidate: "Candidate",
  in_progress: "InProgress",
  completed: "Completed",
};

const STATUS_COLORS: Record<string, string> = {
  candidate: "bg-status-yellow/20 text-status-yellow",
  in_progress: "bg-status-blue/20 text-status-blue",
  completed: "bg-status-green/20 text-status-green",
};

export function EvolutionCenter() {
  const { data: items = [], isLoading } = useQuery(evolutionQueries.list({ limit: 100 }));
  const [selectedItem, setSelectedItem] = useState<EvolutionItemDto | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const navigate = useNavigate();

  const createIssueMutation = useCreateIssueFromItem();
  const closeMutation = useCloseEvolutionItem();

  async function selectItem(itemId: string) {
    try {
      setSelectedItem(await api("GET /api/evolution/items/:itemId", { params: { itemId } }));
    } catch (err: unknown) {
      showToast(`加载详情失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  function handleCreateIssue() {
    if (!selectedItem) return;
    createIssueMutation.mutate(selectedItem.id, {
      onSuccess: (data) => {
        setSelectedItem(data);
        showToast("已创建治理 Issue");
      },
      onError: (err: Error) => showToast(`创建失败：${err.message}`, true),
    });
  }

  function handleOpenCloseDialog() {
    setCloseReason("");
    setCloseDialogOpen(true);
  }

  function handleConfirmClose() {
    if (!selectedItem) return;
    closeMutation.mutate(
      { itemId: selectedItem.id, result: closeReason.trim() || undefined },
      {
        onSuccess: (data) => {
          setSelectedItem(data);
          setCloseDialogOpen(false);
          showToast("已关闭条目");
        },
        onError: (err: Error) => showToast(`关闭失败：${err.message}`, true),
      },
    );
  }

  function navigateToIssue(workspaceId: string, issueId: string) {
    navigate(`/workspaces/${encodeURIComponent(workspaceId)}/issue/${issueId}`);
  }

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Evolution Center" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Evolution</span>
            <span className="text-[11px] text-text-muted">{items.length}</span>
          </div>
          {items.length === 0 ? (
            <div className="py-4 text-[13px] text-text-muted">暂无演进项</div>
          ) : items.map((item) => (
            <button
              key={item.id}
              onClick={() => selectItem(item.id)}
              className={`mb-1 w-full rounded-lg p-3 text-left transition-colors ${selectedItem?.id === item.id ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/5"}`}
            >
              <div className="text-[13px] font-medium">{item.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[item.status] ?? "bg-white/10 text-text-muted"}`}>
                  {STATUS_LABELS[item.status] ?? item.status}
                </span>
                {item.tags?.slice(0, 2).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
              </div>
            </button>
          ))}
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {selectedItem ? (
            <div className="max-w-3xl">
              <div className="mb-6">
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-semibold text-text-primary">{selectedItem.title}</h1>
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[selectedItem.status] ?? "bg-white/10 text-text-muted"}`}>
                    {STATUS_LABELS[selectedItem.status] ?? selectedItem.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedItem.tags?.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                </div>
                <div className="mt-2 text-[11px] text-text-muted">创建于 {new Date(selectedItem.created_at).toLocaleString()}</div>
              </div>

              {selectedItem.content && <div className="rounded-lg border border-white/6 bg-surface-1 p-4 whitespace-pre-wrap text-[13px] leading-6 text-text-secondary">{selectedItem.content}</div>}

              {selectedItem.status === "candidate" && (
                <div className="mt-6 flex gap-2">
                  <button
                    onClick={handleCreateIssue}
                    disabled={createIssueMutation.isPending}
                    className="rounded-md bg-shell-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-shell-400 disabled:opacity-50"
                  >
                    {createIssueMutation.isPending ? "创建中..." : "创建对应 Issue"}
                  </button>
                  <button
                    onClick={handleOpenCloseDialog}
                    disabled={createIssueMutation.isPending}
                    className="rounded-md border border-white/10 bg-surface-0 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-white/20 disabled:opacity-50"
                  >
                    关闭
                  </button>
                </div>
              )}

              {selectedItem.status === "in_progress" && selectedItem.issue_id && (
                <div className="mt-6 rounded-lg border border-white/6 bg-surface-1 p-4">
                  <div className="text-[11px] text-text-muted uppercase tracking-wider mb-1">关联 Issue</div>
                  <button
                    onClick={() => navigateToIssue(selectedItem.workspace_id, selectedItem.issue_id!)}
                    className="text-[13px] text-shell-400 hover:text-shell-300 transition-colors"
                  >
                    {selectedItem.issue_id}
                  </button>
                </div>
              )}

              {selectedItem.status === "completed" && selectedItem.result && (
                <div className="mt-6 rounded-lg border border-white/6 bg-surface-1 p-4">
                  <div className="text-[11px] text-text-muted uppercase tracking-wider mb-1">处理结果</div>
                  <div className="text-[13px] text-text-secondary">{selectedItem.result}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-4 text-[13px] text-text-muted">选择一个演进项查看详情</div>
          )}
        </main>
      </div>

      <Dialog open={closeDialogOpen} onClose={() => setCloseDialogOpen(false)} title="关闭演进项">
        <p className="text-sm text-text-secondary mb-4">确认关闭此演进项？关闭后不再显示操作按钮。</p>
        <textarea
          value={closeReason}
          onChange={(e) => setCloseReason(e.target.value)}
          placeholder="关闭原因（可选）"
          className="mb-4 w-full rounded-md border border-white/10 bg-surface-0 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-shell-500 focus:outline-none"
          rows={3}
        />
        <div className="flex justify-end gap-2">
          <button
            data-autofocus
            onClick={() => setCloseDialogOpen(false)}
            disabled={closeMutation.isPending}
            className="px-4 py-1.5 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirmClose}
            disabled={closeMutation.isPending}
            className="px-4 py-1.5 rounded-md bg-status-red hover:bg-status-red/80 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {closeMutation.isPending ? "关闭中..." : "确认关闭"}
          </button>
        </div>
      </Dialog>
    </>
  );
}
