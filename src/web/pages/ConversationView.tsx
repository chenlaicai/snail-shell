import { useEffect, useRef, useState } from "react";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api";

export function ConversationView() {
  const { messages, currentConversation, wsStatus, setMessages, appendMessage } = useConversationStore();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load messages when conversation changes
  useEffect(() => {
    if (!currentConversation) return;
    api("GET", `/conversations/${currentConversation.id}`)
      .then((data) => {
        setMessages(data.messages || []);
      })
      .catch(() => {});
  }, [currentConversation?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || !currentConversation || sending) return;
    setSending(true);
    try {
      await api("POST", `/conversations/${currentConversation.id}/messages`, {
        content: input.trim(),
      });
      setInput("");
    } catch { /* ignore */ }
    setSending(false);
  }

  if (!currentConversation) {
    return <div id="messages" className="task-board-empty">选择一个 Conversation</div>;
  }

  return (
    <>
      <div id="messages" style={{ flex: 1, overflow: "auto", padding: "var(--space-xl)" }}>
        {messages.length === 0 && (
          <div className="empty-state">暂无消息</div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`msg msg-${msg.role}`}>
            <div className="msg-header">
              <span className="msg-role">{msg.role}</span>
              <span className="msg-time">{new Date(msg.created_at).toLocaleTimeString()}</span>
            </div>
            <div className="msg-body">{msg.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer">
        <div className="composer-input-stack">
          <textarea
            id="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入消息..."
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
        </div>
        <div className="composer-actions button-row">
          <button className="primary-button" onClick={handleSend} disabled={sending || !input.trim()}>
            发送
          </button>
        </div>
        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)", padding: "0 var(--space-xl)" }}>
          {wsStatus === "connected" && <span style={{ color: "var(--color-accent-cyan)" }}>● 已连接</span>}
          {wsStatus === "disconnected" && <span style={{ color: "var(--color-danger-text)" }}>● 已断开</span>}
          {wsStatus === "reconnecting" && <span style={{ color: "var(--color-warning-soft)" }}>● 重连中...</span>}
        </div>
      </div>
    </>
  );
}
