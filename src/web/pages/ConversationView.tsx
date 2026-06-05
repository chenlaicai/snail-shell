import { useEffect, useRef, useState, useCallback } from "react";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api";
import { showToast } from "../components/Toast";
import { extractMessageContent, EventStreamView, ContentBlockView } from "../components/MessageRenderer";
import { useMention } from "../hooks/useMention";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Message {
  id: number;
  role: string;
  from_role?: string;
  status?: string;
  created_at: string;
  events?: Array<Record<string, unknown>>;
  content?: string;
  quoted_message?: { speaker?: string; preview?: string };
  from_conversation_ids?: string[];
}

interface Role {
  name: string;
  description?: string;
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
  const { messages, currentConversation, wsStatus, setMessages, appendMessages } = useConversationStore();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; preview: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // @mention 系统
  const {
    mentionState,
    mentionStatus,
    inputRef,
    updateMention,
    handleKeyDown: handleMentionKeyDown,
    isMentionActive,
    applySelection,
  } = useMention(availableRoles);

  // 加载消息
  const loadMessages = useCallback(() => {
    if (!currentConversation) return;
    api("GET", `/conversations/${currentConversation.id}/messages`)
      .then((data) => {
        const msgs = Array.isArray(data) ? data : data.messages || [];
        setMessages(msgs);
        setHasMore(msgs.length >= 100); // 假设每页 100 条
      })
      .catch((err) => showToast(`加载消息失败：${err.message}`, true));
  }, [currentConversation?.id]);

  // 加载更多消息（分页）
  const loadMoreMessages = useCallback(() => {
    if (!currentConversation || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const oldestId = messages.length > 0 ? messages[0].id : undefined;
    const cursorParam = oldestId ? `?before_id=${oldestId}` : "";
    api("GET", `/conversations/${currentConversation.id}/messages${cursorParam}`)
      .then((data) => {
        const olderMsgs = Array.isArray(data) ? data : data.messages || [];
        if (olderMsgs.length === 0) {
          setHasMore(false);
        } else {
          appendMessages(olderMsgs);
          setHasMore(olderMsgs.length >= 100);
        }
      })
      .catch((err) => showToast(`加载更多消息失败：${err.message}`, true))
      .finally(() => setLoadingMore(false));
  }, [currentConversation?.id, loadingMore, hasMore, messages]);

  // 加载可用角色（用于 @mention）
  useEffect(() => {
    if (!currentConversation) return;
    api("GET", `/conversations/${currentConversation.id}`)
      .then((data) => {
        const roles = (data.participating_roles || []).map((name: string) => ({ name }));
        setAvailableRoles(roles);
      })
      .catch(() => {});
  }, [currentConversation?.id]);

  // Conversation 变化时加载消息
  useEffect(() => {
    loadMessages();
  }, [currentConversation?.id]);

  // 消息变化时滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 滚动到顶部时加载更多
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (container.scrollTop < 50 && hasMore && !loadingMore) {
        loadMoreMessages();
      }
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [hasMore, loadingMore, loadMoreMessages]);

  // 发送消息（乐观渲染：先显示用户消息，再等待服务器确认）
  async function handleSend() {
    if (!input.trim() || !currentConversation || sending) return;
    const content = input.trim();
    const optimisticId = Date.now(); // 临时 ID

    // 乐观添加用户消息
    const optimisticMsg: Message = {
      id: optimisticId,
      role: "user",
      content,
      created_at: new Date().toISOString(),
      events: [{ category: "content", kind: "text", payload: { text: content } }],
    };
    appendMessage(optimisticMsg);
    setInput("");
    setReplyTo(null);
    setSending(true);

    try {
      const body: Record<string, unknown> = { content };
      if (replyTo) body.reply_to = replyTo.id;
      await api("POST", `/conversations/${currentConversation.id}/messages`, body);
      // 服务器确认后重新加载消息（替换乐观消息）
      loadMessages();
    } catch (err: any) {
      showToast(`发送失败：${err.message}`, true);
      // 发送失败，移除乐观消息
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    }
    setSending(false);
  }

  // 追加消息到列表
  function appendMessage(msg: Message) {
    setMessages((prev) => [...prev, msg]);
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
      await api("POST", `/conversations/${conversationId}/messages/${messageId}/approve-tool`, { approved: true });
      loadMessages();
    } catch (err: any) {
      showToast(`审批失败: ${err.message}`, true);
    }
  }

  // 权限拒绝
  async function handlePermissionDeny(conversationId: string, messageId: number) {
    try {
      await api("POST", `/conversations/${conversationId}/messages/${messageId}/approve-tool`, { approved: false });
      loadMessages();
    } catch (err: any) {
      showToast(`拒绝失败: ${err.message}`, true);
    }
  }

  // 输入变化时更新 mention
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    updateMention();
  }

  // 键盘事件（mention 导航 + 发送）
  function handleKeyDown(e: React.KeyboardEvent) {
    // Shift+Enter 始终发送（无论 mention 是否激活）
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    // mention 激活时，让 mention hook 处理其他按键
    if (isMentionActive) {
      handleMentionKeyDown(e);
      return;
    }
    // Enter（无 Shift）走浏览器默认换行
  }

  const streamingMessage = messages.find((m: Message) => m.status === "streaming");
  const isAiRunning = !!streamingMessage;
  const canSend = input.trim() && !sending && !isAiRunning;

  if (!currentConversation) {
    return <div id="messages" className="task-board-empty">选择一个 Conversation</div>;
  }

  return (
    <>
      <div id="messages" className="conv-messages" ref={messagesContainerRef}>
        {hasMore && (
          <div style={{ textAlign: "center", padding: "var(--space-sm)" }}>
            <Button variant="ghost" size="sm" onClick={loadMoreMessages} disabled={loadingMore}>
              {loadingMore ? "加载中..." : "加载更多消息"}
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="empty-state">暂无消息</div>
        )}
        {messages.map((msg: Message) => {
          const msgContent = extractMessageContent(msg);
          const roleName = extractRoleName(msg);
          const runtimeUsage = extractRuntimeUsage(msg);
          const hasContent = msgContent.processBlocks.length > 0 || msgContent.finalBlocks.length > 0;
          const shouldFoldProcess = !msgContent.isStreaming && msgContent.finalBlocks.length > 0;
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`msg ${msg.role}${msgContent.isStreaming ? " streaming" : ""}`}>
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
                {/* 引用消息 */}
                {msg.quoted_message && (
                  <blockquote className="msg-quote">
                    {msg.quoted_message.speaker && <strong>{msg.quoted_message.speaker}: </strong>}
                    {msg.quoted_message.preview || "(空消息)"}
                  </blockquote>
                )}
                {!hasContent && msgContent.isStreaming && (
                  <div className="running-snail">
                    <div className="snail-track">
                      <span className="snail-icon">🐌</span>
                    </div>
                    <span>Snail is starting</span>
                  </div>
                )}
                {!hasContent && !msgContent.isStreaming && (
                  <span className="meta">(空消息)</span>
                )}
                {msgContent.processBlocks.length > 0 && (
                  <EventStreamView
                    blocks={msgContent.processBlocks}
                    defaultOpen={!shouldFoldProcess || msgContent.containsQuestion}
                    onApprove={(tool, input) => handlePermissionApprove(String(currentConversation.id), msg.id)}
                    onDeny={(tool, input) => handlePermissionDeny(String(currentConversation.id), msg.id)}
                  />
                )}
                {msgContent.finalBlocks.map((block, i) => (
                  <ContentBlockView
                    key={i}
                    block={block}
                    onApprove={(tool, input) => handlePermissionApprove(String(currentConversation.id), msg.id)}
                    onDeny={(tool, input) => handlePermissionDeny(String(currentConversation.id), msg.id)}
                  />
                ))}
                {msgContent.isStreaming && hasContent && (
                  <div className="running-snail">
                    <div className="snail-track">
                      <span className="snail-icon">🐌</span>
                    </div>
                    <span>Snail is still working</span>
                  </div>
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
          <Textarea
            ref={inputRef}
            id="input"
            value={input}
            onChange={handleInputChange}
            placeholder="输入 @开发者 与指定 role 对话；未指定时默认发送给当前主 role"
            rows={2}
            onKeyDown={handleKeyDown}
          />
          <div className="composer-hints">
            <span className="send-hint">Shift+Enter 发送</span>
            {mentionStatus && <span className="mention-status">{mentionStatus}</span>}
          </div>
          {/* @mention 建议列表 */}
          {isMentionActive && (
            <div className="mention-suggestions">
              {mentionState.suggestions.map((role, i) => (
                <div
                  key={role.name}
                  className={`mention-suggestion${i === mentionState.selectedIndex ? " selected" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); applySelection(i); }}
                >
                  <span className="mention-name">{role.name}</span>
                  {role.description && <span className="mention-desc">{role.description}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="composer-actions button-row">
          {streamingMessage ? (
            <Button variant="destructive" onClick={() => handleInterrupt(streamingMessage.id)}>
              中断 Snail
            </Button>
          ) : (
            <Button onClick={handleSend} disabled={!canSend}>
              发送
            </Button>
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
