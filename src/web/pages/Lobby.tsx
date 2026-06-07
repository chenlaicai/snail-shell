/**
 * Lobby - IM 大厅
 *
 * 功能：会话列表、查看消息、重置、删除
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { lobbyQueries } from "../queries/lobby.queries";
import { queryKeys } from "../queries/keys";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "../components/ui/dialog";
import type { LobbyMessageDto } from "../types";

export function Lobby() {
  const queryClient = useQueryClient();
  const { data: sessions = [], isLoading } = useQuery(lobbyQueries.sessions());
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<LobbyMessageDto[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"reset" | "delete">("delete");

  async function selectSession(sessionId: string) {
    setSelectedSession(sessionId);
    try {
      const data = await api("GET /api/lobby/sessions/:sessionId", { params: { sessionId } });
      setSessionMessages(data.messages || []);
    } catch (err: unknown) {
      showToast(`加载消息失败：${err instanceof Error ? err.message : String(err)}`, true);
      setSessionMessages([]);
    }
  }

  function openConfirm(sessionId: string, action: "reset" | "delete") {
    setConfirmTarget(sessionId);
    setConfirmAction(action);
    setConfirmOpen(true);
  }

  async function handleConfirmAction() {
    if (!confirmTarget) return;
    const sessionId = confirmTarget;
    const action = confirmAction;
    setConfirmOpen(false);
    setConfirmTarget(null);
    if (action === "reset") {
      try {
        await api("POST /api/lobby/sessions/:sessionId/reset", { params: { sessionId } });
        showToast("会话已重置");
        setSessionMessages([]);
      } catch (err: unknown) {
        showToast(`重置失败：${err instanceof Error ? err.message : String(err)}`, true);
      }
    } else {
      try {
        await api("DELETE /api/lobby/sessions/:sessionId", { params: { sessionId } });
        showToast("会话已删除");
        queryClient.invalidateQueries({ queryKey: queryKeys.lobby.sessions });
        if (selectedSession === sessionId) {
          setSelectedSession(null);
          setSessionMessages([]);
        }
      } catch (err: unknown) {
        showToast(`删除失败：${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  }

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="lobby">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">IM 大厅</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{sessions.length} 个会话</span>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* 左侧会话列表 */}
          <div className="w-[280px] shrink-0 border-r border-[var(--color-border-muted)] overflow-auto p-[var(--space-md)]">
            {sessions.length === 0 ? (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无活跃会话</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`cursor-pointer p-[var(--space-sm)] rounded-[var(--radius-sm)] mb-1 transition-colors ${
                    selectedSession === s.id
                      ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                  onClick={() => selectSession(s.id)}
                >
                  <div className="font-semibold text-[var(--font-size-sm)]">{s.channel_type}</div>
                  <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)]">
                    {s.navigation_level} · {new Date(s.created_at).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 右侧消息 */}
          <div className="flex-1 overflow-auto p-[var(--space-xl)]">
            {selectedSession ? (
              <div>
                <div className="flex justify-between items-center mb-[var(--space-lg)]">
                  <h2 className="m-0 text-[var(--font-size-md)]">会话消息</h2>
                  <div className="flex gap-[var(--space-sm)]">
                    <Button variant="outline" size="sm" onClick={() => openConfirm(selectedSession, "reset")}>重置</Button>
                    <Button variant="destructive" size="sm" onClick={() => openConfirm(selectedSession, "delete")}>删除</Button>
                  </div>
                </div>
                {sessionMessages.length === 0 ? (
                  <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无消息</div>
                ) : (
                  <div className="flex flex-col gap-[var(--space-md)]">
                    {sessionMessages.map((msg) => (
                      <div key={msg.id} className={`msg max-w-[var(--message-max-width)] px-[14px] py-[var(--space-md)] rounded-[14px] leading-[1.6] whitespace-pre-wrap min-w-0 [overflow-wrap:break-word] ${
                        msg.direction === "in"
                          ? "self-start bg-[var(--color-assistant-msg-bg)] border border-[var(--color-border-muted)] rounded-bl-[var(--space-2xs)]"
                          : "self-end bg-[var(--color-user-msg-bg)] border border-[var(--color-border-muted)] rounded-br-[var(--space-2xs)]"
                      }`}>
                        <div className="flex items-center justify-between gap-[var(--space-md)] mb-[var(--space-2xs)]">
                          <div className="text-[var(--font-size-xs)] text-[var(--color-text-blue-muted)] uppercase tracking-[0.08em]">{msg.direction}</div>
                          <div className="shrink-0 text-[var(--font-size-xs)] text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">{new Date(msg.created_at).toLocaleTimeString()}</div>
                        </div>
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">选择一个会话查看消息</div>
            )}
          </div>
        </div>
      </div>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="确认操作">
        <p>{confirmAction === "reset" ? "确定重置此会话？" : "确定删除此会话？"}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="destructive" onClick={handleConfirmAction}>确定</Button>
        </div>
      </Dialog>
    </div>
  );
}
