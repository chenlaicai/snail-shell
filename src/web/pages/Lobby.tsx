/**
 * Lobby - IM 大厅
 *
 * 功能：会话列表、查看消息、重置、删除
 */

import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "../components/ui/dialog";
import type { LobbySessionDto, LobbyMessageDto } from "../types";

export function Lobby() {
  const [sessions, setSessions] = useState<LobbySessionDto[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<LobbyMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"reset" | "delete">("delete");

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const data = await api("GET /api/lobby/sessions");
      setSessions(data);
    } catch (err: unknown) {
      showToast(`加载会话失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setLoading(false);
  }

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
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (selectedSession === sessionId) {
          setSelectedSession(null);
          setSessionMessages([]);
        }
      } catch (err: unknown) {
        showToast(`删除失败：${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="lobby">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">IM 大厅</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{sessions.length} 个会话</span>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* 左侧会话列表 */}
          <div style={{ width: 280, borderRight: "1px solid var(--color-border-muted)", overflow: "auto", padding: "var(--space-md)" }}>
            {sessions.length === 0 ? (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无活跃会话</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`nav-item${selectedSession === s.id ? " active" : ""}`}
                  onClick={() => selectSession(s.id)}
                  style={{ cursor: "pointer", padding: "8px", borderRadius: 6, marginBottom: 4 }}
                >
                  <div style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>{s.channel_type}</div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)" }}>
                    {s.navigation_level} · {new Date(s.created_at).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 右侧消息 */}
          <div style={{ flex: 1, overflow: "auto", padding: "var(--space-xl)" }}>
            {selectedSession ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-lg)" }}>
                  <h2 style={{ margin: 0, fontSize: "var(--font-size-md)" }}>会话消息</h2>
                  <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                    <Button variant="outline" size="sm" onClick={() => openConfirm(selectedSession, "reset")}>重置</Button>
                    <Button variant="destructive" size="sm" onClick={() => openConfirm(selectedSession, "delete")}>删除</Button>
                  </div>
                </div>
                {sessionMessages.length === 0 ? (
                  <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无消息</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
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
        <div style={{ display: "flex", gap: "var(--space-sm, 8px)", justifyContent: "flex-end" }}>
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="destructive" onClick={handleConfirmAction}>确定</Button>
        </div>
      </Dialog>
    </div>
  );
}
