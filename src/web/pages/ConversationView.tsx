import { useEffect, useRef, useState } from "react";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api";
import { showToast } from "../components/Toast";

interface MessageEvent {
  id: number;
  message_id: number;
  seq: number;
  category: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface Message {
  id: number;
  role: string;
  from_role?: string;
  status?: string;
  created_at: string;
  events?: MessageEvent[];
  content?: string;
}

/** 从消息事件中提取文本内容 */
function extractContent(msg: Message): string {
  if (msg.content) return msg.content;
  if (!msg.events || msg.events.length === 0) return "";
  const parts: string[] = [];
  for (const event of msg.events) {
    const payload = event.payload;
    if (event.category === "content" && event.kind === "text") {
      // 主要文本内容
      parts.push(String(payload.text || ""));
    } else if (event.category === "content" && event.kind === "markdown") {
      parts.push(String(payload.text || ""));
    } else if (event.category === "content_block") {
      // 兼容旧格式
      if (payload.type === "text" || payload.type === "rich_text" || payload.type === "markdown") {
        parts.push(String(payload.text || ""));
      } else if (payload.type === "question") {
        parts.push([payload.title, payload.question].filter(Boolean).join("\n"));
      } else if (payload.type === "question_response") {
        parts.push(String(payload.summary || ""));
      } else if (payload.type === "tool_call_card") {
        parts.push(String(payload.summary || payload.detail || payload.tool_name || ""));
      } else if (payload.type === "tool_result") {
        parts.push(String(payload.output_text || payload.error_text || ""));
      }
    }
  }
  return parts.filter(Boolean).join("\n");
}

/** 从消息中提取角色显示名 */
function extractRoleName(msg: Message): string {
  if (msg.from_role) return msg.from_role;
  if (msg.role === "user") return "用户";
  if (msg.role === "assistant") return "AI";
  return msg.role;
}

export function ConversationView() {
  const { messages, currentConversation, wsStatus, setMessages } = useConversationStore();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; preview: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load messages when conversation changes
  useEffect(() => {
    if (!currentConversation) return;
    api("GET", `/conversations/${currentConversation.id}/messages`)
      .then((data) => {
        setMessages(Array.isArray(data) ? data : data.messages || []);
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

  async function handleInterrupt(messageId: number) {
    if (!currentConversation) return;
    try {
      await api("POST", `/conversations/${currentConversation.id}/messages/${messageId}/interrupt`);
      showToast("已发送中断请求");
    } catch (err: any) {
      showToast(`中断失败：${err.message}`, true);
    }
  }

  const streamingMessage = messages.find((m: Message) => m.status === "streaming");

  if (!currentConversation) {
    return <div id="messages" className="task-board-empty">选择一个 Conversation</div>;
  }

  return (
    <>
      <div id="messages" className="conv-messages">
        {messages.length === 0 && (
          <div className="empty-state">暂无消息</div>
        )}
        {messages.map((msg: Message) => {
          const content = extractContent(msg);
          const roleName = extractRoleName(msg);
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`msg msg-${msg.role}`}>
              <div className="msg-header">
                <div className="role">{roleName}</div>
                <div className="msg-meta">
                  <div className="timestamp">{new Date(msg.created_at).toLocaleTimeString()}</div>
                  <button
                    className="ghost-button"
                    style={{ fontSize: "10px", padding: "2px 6px" }}
                    onClick={() => setReplyTo({ id: msg.id, preview: content.slice(0, 50) })}
                  >
                    回复
                  </button>
                </div>
              </div>
              <div className="msg-content">{content || <span className="meta">(空消息)</span>}</div>
            </div>
          );
        })}
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
