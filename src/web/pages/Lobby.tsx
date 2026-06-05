/**
 * Lobby - IM 大厅
 *
 * 功能：会话列表、查看消息、重置、删除
 */

import { useEffect, useState } from "react";
import { api } from "../services/api";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import type { LobbySessionDto, LobbyMessageDto } from "../types";

export function Lobby() {
  const [sessions, setSessions] = useState<LobbySessionDto[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<LobbyMessageDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const data = await api("GET", "/lobby/sessions");
      setSessions(data);
    } catch (err: unknown) {
      showToast(`加载会话失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setLoading(false);
  }

  async function selectSession(sessionId: string) {
    setSelectedSession(sessionId);
    try {
      const data = await api("GET", `/lobby/sessions/${sessionId}`);
      setSessionMessages(data.messages || []);
    } catch (err: unknown) {
      showToast(`加载消息失败：${err instanceof Error ? err.message : String(err)}`, true);
      setSessionMessages([]);
    }
  }

  async function handleReset(sessionId: string) {
    if (!confirm("确定重置此会话？")) return;
    try {
      await api("POST", `/lobby/sessions/${sessionId}/reset`);
      showToast("会话已重置");
      setSessionMessages([]);
    } catch (err: unknown) {
      showToast(`重置失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  async function handleDelete(sessionId: string) {
    if (!confirm("确定删除此会话？")) return;
    try {
      await api("DELETE", `/lobby/sessions/${sessionId}`);
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

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="lobby">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">IM 大厅</span>
            <span className="board-subtitle">{sessions.length} 个会话</span>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* 左侧会话列表 */}
          <div style={{ width: 280, borderRight: "1px solid var(--color-border-muted)", overflow: "auto", padding: "var(--space-md)" }}>
            {sessions.length === 0 ? (
              <div className="empty-state">暂无活跃会话</div>
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
                    <Button variant="outline" size="sm" onClick={() => handleReset(selectedSession)}>重置</Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(selectedSession)}>删除</Button>
                  </div>
                </div>
                {sessionMessages.length === 0 ? (
                  <div className="empty-state">暂无消息</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                    {sessionMessages.map((msg) => (
                      <div key={msg.id} className={`msg msg-${msg.direction}`}>
                        <div className="msg-header">
                          <div className="role">{msg.direction}</div>
                          <div className="timestamp">{new Date(msg.created_at).toLocaleTimeString()}</div>
                        </div>
                        <div className="msg-content">{msg.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">选择一个会话查看消息</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
