import { useEffect, useRef, useState } from "react";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api";
import { showToast } from "../components/Toast";
import { extractMessageContent, EventStreamView, ContentBlockView } from "../components/MessageRenderer";

interface Message {
  id: number;
  role: string;
  from_role?: string;
  status?: string;
  created_at: string;
  events?: Array<Record<string, unknown>>;
  content?: string;
}

/** 从消息中提取角色显示名 */
function extractRoleName(msg: Message): string {
  if (msg.from_role) return msg.from_role;
  if (msg.role === "user") return "用户";
  if (msg.role === "assistant") return "AI";
  return msg.role;
}

/** 运行时用量信息 */
interface RuntimeUsage {
  label: string;
  percentLabel: string;
  title: string;
  isPlaceholder: boolean;
}

/** 从消息事件中提取 token 用量 */
function extractRuntimeUsage(msg: Message): RuntimeUsage | null {
  if (!msg.events) return null;
  const usageEvents = msg.events.filter(
    (e) => e.kind === "signal" && e.payload?.type === "runtime_usage" && e.payload?.detail
  );
  const detail = usageEvents.at(-1)?.payload?.detail as Record<string, unknown> | undefined;
  if (!detail || typeof detail !== "object") {
    // 流式过程中 usage 数据尚未到达
    return { label: "- / -", percentLabel: "-", title: "上下文用量：数据尚未到达", isPlaceholder: true };
  }
  const inputTokens = Number(detail.input_tokens ?? detail.input ?? 0);
  const outputTokens = Number(detail.output_tokens ?? detail.output ?? 0);
  const contextWindow = Number(detail.context_window ?? detail.contextWindow ?? 0);
  const usedTokens = inputTokens + outputTokens;
  const percent = contextWindow > 0 ? Math.round((usedTokens / contextWindow) * 100) : null;
  const label = `${formatTokenCount(inputTokens)} / ${formatTokenCount(contextWindow)}`;
  const percentLabel = percent !== null ? `${percent}%` : "-";
  return {
    label,
    percentLabel,
    title: `上下文用量：${formatTokenCount(inputTokens)} in + ${formatTokenCount(outputTokens)} out / ${formatTokenCount(contextWindow)} (${percentLabel})`,
    isPlaceholder: false,
  };
}

function formatTokenCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** 提取消息纯文本摘要（用于回复预览） */
function extractTextSummary(msg: Message): string {
  const content = extractMessageContent(msg);
  for (const block of content.finalBlocks) {
    if (block.text) return block.text.slice(0, 80);
  }
  for (const block of content.processBlocks) {
    if (block.summary) return block.summary.slice(0, 80);
  }
  return "";
}

export function ConversationView() {
  const { messages, currentConversation, wsStatus, setMessages } = useConversationStore();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; preview: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载消息
  function loadMessages() {
    if (!currentConversation) return;
    api("GET", `/conversations/${currentConversation.id}/messages`)
      .then((data) => {
        setMessages(Array.isArray(data) ? data : data.messages || []);
      })
      .catch((err) => showToast(`加载消息失败：${err.message}`, true));
  }

  // Conversation 变化时加载消息
  useEffect(() => {
    loadMessages();
  }, [currentConversation?.id]);

  // 消息变化时滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 发送消息
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
      loadMessages();
    } catch (err: any) {
      showToast(`发送失败：${err.message}`, true);
    }
    setSending(false);
  }

  // 中断 AI
  async function handleInterrupt(messageId: number) {
    if (!currentConversation) return;
    try {
      await api("POST", `/conversations/${currentConversation.id}/messages/${messageId}/interrupt`);
      showToast("已发送中断请求");
    } catch (err: any) {
      showToast(`中断失败：${err.message}`, true);
    }
  }

  // 权限审批
  async function handlePermissionApprove(conversationId: string, messageId: number) {
    try {
      await api("POST", `/api/conversations/${conversationId}/messages/${messageId}/approve-tool`, { approved: true });
      loadMessages();
    } catch (err: any) {
      showToast(`审批失败: ${err.message}`, true);
    }
  }

  // 权限拒绝
  async function handlePermissionDeny(conversationId: string, messageId: number) {
    try {
      await api("POST", `/api/conversations/${conversationId}/messages/${messageId}/approve-tool`, { approved: false });
      loadMessages();
    } catch (err: any) {
      showToast(`拒绝失败: ${err.message}`, true);
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
          const msgContent = extractMessageContent(msg);
          const roleName = extractRoleName(msg);
          const runtimeUsage = extractRuntimeUsage(msg);
          const hasContent = msgContent.processBlocks.length > 0 || msgContent.finalBlocks.length > 0;
          // 完成态：流式过程折叠，最终答复展开；流式中：全部展开
          const shouldFoldProcess = !msgContent.isStreaming && msgContent.finalBlocks.length > 0;
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`msg msg-${msg.role}${msgContent.isStreaming ? " streaming" : ""}`}>
              <div className="msg-header">
                <div className="role">{roleName}</div>
                <div className="msg-meta">
                  {runtimeUsage && (
                    <span className={`runtime-usage${runtimeUsage.isPlaceholder ? " is-placeholder" : ""}`} title={runtimeUsage.title}>
                      <span className="runtime-usage-label">{runtimeUsage.label}</span>
                      <span className="runtime-usage-percent">{runtimeUsage.percentLabel}</span>
                    </span>
                  )}
                  <div className="timestamp">{new Date(msg.created_at).toLocaleTimeString()}</div>
                  <button
                    className="ghost-button"
                    style={{ fontSize: "10px", padding: "2px 6px" }}
                    onClick={() => setReplyTo({ id: msg.id, preview: extractTextSummary(msg) })}
                  >
                    回复
                  </button>
                </div>
              </div>
              <div className="msg-content">
                {!hasContent && msgContent.isStreaming && (
                  <div className="running-indicator">● 工作中...</div>
                )}
                {!hasContent && !msgContent.isStreaming && (
                  <span className="meta">(空消息)</span>
                )}
                {/* 流式过程（折叠/展开） */}
                {msgContent.processBlocks.length > 0 && (
                  <EventStreamView
                    blocks={msgContent.processBlocks}
                    defaultOpen={!shouldFoldProcess || msgContent.containsQuestion}
                    onApprove={(tool, input) => handlePermissionApprove(String(currentConversation.id), msg.id)}
                    onDeny={(tool, input) => handlePermissionDeny(String(currentConversation.id), msg.id)}
                  />
                )}
                {/* 最终答复 */}
                {msgContent.finalBlocks.map((block, i) => (
                  <ContentBlockView
                    key={i}
                    block={block}
                    onApprove={(tool, input) => handlePermissionApprove(String(currentConversation.id), msg.id)}
                    onDeny={(tool, input) => handlePermissionDeny(String(currentConversation.id), msg.id)}
                  />
                ))}
                {/* 流式中指示器 */}
                {msgContent.isStreaming && hasContent && (
                  <div className="running-indicator">●</div>
                )}
              </div>
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
            placeholder="输入 @开发者 与指定 role 对话；未指定时默认发送给当前主 role"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="composer-hints">
            <span className="send-hint">Shift+Enter 发送</span>
          </div>
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
