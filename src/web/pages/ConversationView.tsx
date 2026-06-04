import { useEffect, useRef, useState } from "react";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api";
import { showToast } from "../components/Toast";

export function ConversationView() {
  const { messages, currentConversation, wsStatus, setMessages, appendMessage } = useConversationStore();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; preview: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load messages when conversation changes
  useEffect(() => {
    if (!currentConversation) return;
    api("GET", `/conversations/${currentConversation.id}`)
      .then((data) => {
        setMessages(data.messages || []);
      })
      .catch((err) => showToast(`加载消息失败：${err.message}`, true));
  }, [currentConversation?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || !currentConversation || sending) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = { content: input.trim() };
      if (replyTo) {
        body.reply_to = replyTo.id;
        setReplyTo(null);
      }
      await api("POST", `/conversations/${currentConversation.id}/messages`, body);
      setInput("");
    } catch (err: any) {
      showToast(`发送失败：${err.message}`, true);
    }
    setSending(false);
  }

  async function handleInterrupt(messageId: string) {
    if (!currentConversation) return;
    try {
      await api("POST", `/conversations/${currentConversation.id}/messages/${messageId}/interrupt`);
      showToast("已发送中断请求");
    } catch (err: any) {
      showToast(`中断失败：${err.message}`, true);
    }
  }

  const streamingMessage = messages.find((m) => m.status === "streaming");

  if (!currentConversation) {
    return <div id="messages" className="task-board-empty">选择一个 Conversation</div>;
  }

  return (
    <>
      <div id="messages" className="conv-messages">
        {messages.length === 0 && (
          <div className="empty-state">暂无消息</div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} id={`msg-${msg.id}`} className={`msg msg-${msg.role}`}>
            <div className="msg-header">
              <span className="msg-role">{msg.role}</span>
              <span className="msg-time">{new Date(msg.created_at).toLocaleTimeString()}</span>
              <button
                className="ghost-button"
                style={{ fontSize: "10px", padding: "2px 6px" }}
                onClick={() => setReplyTo({ id: msg.id, preview: (msg.content || "").slice(0, 50) })}
              >
                回复
              </button>
            </div>
            <div className="msg-body">{msg.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer">
        {replyTo && (
          <div className="reply-banner">
            <div id="reply-banner-text">回复：{replyTo.preview}</div>
            <button className="reply-cancel" onClick={() => setReplyTo(null)}>取消</button>
          </div>
        )}
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
          {streamingMessage ? (
            <button className="danger-button" onClick={() => handleInterrupt(streamingMessage.id)}>
              中断 Snail
            </button>
          ) : (
            <button className="primary-button" onClick={handleSend} disabled={sending || !input.trim()}>
              发送
            </button>
          )}
        </div>
        <div className="ws-status">
          {wsStatus === "connected" && <span className="connected">● 已连接</span>}
          {wsStatus === "disconnected" && <span className="disconnected">● 已断开</span>}
          {wsStatus === "reconnecting" && <span className="reconnecting">● 重连中...</span>}
        </div>
      </div>
    </>
  );
}
