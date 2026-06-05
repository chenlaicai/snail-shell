import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api-client";
import { conversationQueries } from "../queries/conversation.queries";
import { queryKeys } from "../queries/keys";
import { showToast } from "../components/Toast";
import { extractMessageContent, EventStreamView, ContentBlockView } from "../components/MessageRenderer";
import { useMention } from "../hooks/useMention";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { MessageDto, ConversationDetailDto } from "../types";

interface Role { name: string; description?: string; }
interface RuntimeUsage { label: string; percentLabel: string; title: string; isPlaceholder: boolean; }

function extractRoleName(msg: MessageDto): string {
  if (msg.from_role) return msg.from_role;
  if (msg.role === "user") return "用户";
  if (msg.role === "assistant") return "AI";
  return msg.role;
}

function extractRuntimeUsage(msg: MessageDto): RuntimeUsage | null {
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
  const label = `${fmt(inputTokens)} / ${fmt(contextWindow)}`;
  const percentLabel = percent !== null ? `${percent}%` : "-";
  return { label, percentLabel, title: `上下文用量：${fmt(inputTokens)} in + ${fmt(outputTokens)} out / ${fmt(contextWindow)} (${percentLabel})`, isPlaceholder: false };
}

function fmt(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function extractTextSummary(msg: MessageDto): string {
  const content = extractMessageContent(msg);
  for (const block of content.finalBlocks) { if (block.text) return block.text.slice(0, 80); }
  for (const block of content.processBlocks) { if (block.summary) return block.summary.slice(0, 80); }
  return "";
}

interface Props { conversationId: string | null; }

export function ConversationView({ conversationId }: Props) {
  const queryClient = useQueryClient();
  const wsStatus = useConversationStore((s) => s.wsStatus);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; preview: string } | null>(null);
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const { mentionState, mentionStatus, inputRef, updateMention, handleKeyDown: handleMentionKeyDown, isMentionActive, applySelection } = useMention(availableRoles);

  // TanStack Query: 消息列表
  const { data: messages = [] } = useQuery({
    ...conversationQueries.messages(conversationId || ""),
    enabled: !!conversationId,
  });

  // 加载可用角色
  useEffect(() => {
    if (!conversationId) return;
    api("GET /api/conversations/:conversationId", { params: { conversationId } })
      .then((data: ConversationDetailDto) => {
        setAvailableRoles((data.participating_roles || []).map((name) => ({ name })));
      })
      .catch(() => {});
  }, [conversationId]);

  // 消息变化时滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 发送消息（乐观渲染）
  async function handleSend() {
    if (!input.trim() || !conversationId || sending) return;
    const content = input.trim();
    const optimisticId = Date.now();
    const optimisticMsg: MessageDto = {
      id: optimisticId, conversation_id: conversationId, client_id: null,
      from_role: null, to_roles: [], role: "user",
      quoted_message_id: null, context_cutoff_at: "", runtime: null,
      status: "streaming", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      content, events: [], quoted_message: null,
    };
    // 乐观插入
    queryClient.setQueryData(queryKeys.conversations.messages(conversationId), (old: MessageDto[] | undefined) => [...(old ?? []), optimisticMsg]);
    setInput(""); setReplyTo(null); setSending(true);
    try {
      const body: Record<string, unknown> = { content };
      if (replyTo) body.quoted_message_id = replyTo.id;
      await api("POST /api/conversations/:conversationId/messages", { params: { conversationId }, body });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.messages(conversationId) });
    } catch (err: unknown) {
      showToast(`发送失败：${err instanceof Error ? err.message : String(err)}`, true);
      queryClient.setQueryData(queryKeys.conversations.messages(conversationId), (old: MessageDto[] | undefined) => old?.filter((m) => m.id !== optimisticId));
    }
    setSending(false);
  }

  async function handleInterrupt(messageId: number) {
    if (!conversationId) return;
    try { await api("POST /api/conversations/:conversationId/messages/:messageId/interrupt", { params: { conversationId, messageId } }); showToast("已发送中断请求"); }
    catch (err: unknown) { showToast(`中断失败：${err instanceof Error ? err.message : String(err)}`, true); }
  }

  async function handlePermissionApprove(convId: string, messageId: number) {
    try { await api("POST /api/conversations/:conversationId/messages/:messageId/approve-tool", { params: { conversationId: convId, messageId }, body: { approved: true } }); queryClient.invalidateQueries({ queryKey: queryKeys.conversations.messages(convId) }); }
    catch (err: unknown) { showToast(`审批失败: ${err instanceof Error ? err.message : String(err)}`, true); }
  }

  async function handlePermissionDeny(convId: string, messageId: number) {
    try { await api("POST /api/conversations/:conversationId/messages/:messageId/approve-tool", { params: { conversationId: convId, messageId }, body: { approved: false } }); queryClient.invalidateQueries({ queryKey: queryKeys.conversations.messages(convId) }); }
    catch (err: unknown) { showToast(`拒绝失败: ${err instanceof Error ? err.message : String(err)}`, true); }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) { setInput(e.target.value); updateMention(); }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); handleSend(); return; }
    if (isMentionActive) { handleMentionKeyDown(e); return; }
  }

  const streamingMessage = messages.find((m) => m.status === "streaming");
  const isAiRunning = !!streamingMessage;
  const canSend = input.trim() && !sending && !isAiRunning;

  if (!conversationId) {
    return <div id="messages" className="task-board-empty">选择一个 Conversation</div>;
  }

  return (
    <>
      <div id="messages" className="conv-messages" ref={messagesContainerRef}>
        {messages.length === 0 && <div className="empty-state">暂无消息</div>}
        {messages.map((msg) => {
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
                  <button className="ghost-button" style={{ fontSize: "10px", padding: "2px 6px" }} onClick={() => setReplyTo({ id: msg.id, preview: extractTextSummary(msg) })}>回复</button>
                </div>
              </div>
              <div className="msg-content">
                {msg.quoted_message && (
                  <blockquote className="msg-quote">
                    {msg.quoted_message.speaker && <strong>{msg.quoted_message.speaker}: </strong>}
                    {msg.quoted_message.preview || "(空消息)"}
                  </blockquote>
                )}
                {!hasContent && msgContent.isStreaming && (
                  <div className="running-snail"><div className="snail-track"><span className="snail-icon">🐌</span></div><span>Snail is starting</span></div>
                )}
                {!hasContent && !msgContent.isStreaming && <span className="meta">(空消息)</span>}
                {msgContent.processBlocks.length > 0 && (
                  <EventStreamView blocks={msgContent.processBlocks} defaultOpen={!shouldFoldProcess || msgContent.containsQuestion}
                    onApprove={() => handlePermissionApprove(conversationId, msg.id)} onDeny={() => handlePermissionDeny(conversationId, msg.id)} />
                )}
                {msgContent.finalBlocks.map((block, i) => (
                  <ContentBlockView key={i} block={block}
                    onApprove={() => handlePermissionApprove(conversationId, msg.id)} onDeny={() => handlePermissionDeny(conversationId, msg.id)} />
                ))}
                {msgContent.isStreaming && hasContent && (
                  <div className="running-snail"><div className="snail-track"><span className="snail-icon">🐌</span></div><span>Snail is still working</span></div>
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
          <Textarea ref={inputRef} id="input" value={input} onChange={handleInputChange}
            placeholder="输入 @开发者 与指定 role 对话；未指定时默认发送给当前主 role" rows={2} onKeyDown={handleKeyDown} />
          <div className="composer-hints">
            <span className="send-hint">Shift+Enter 发送</span>
            {mentionStatus && <span className="mention-status">{mentionStatus}</span>}
          </div>
          {isMentionActive && (
            <div className="mention-suggestions">
              {mentionState.suggestions.map((role, i) => (
                <div key={role.name} className={`mention-suggestion${i === mentionState.selectedIndex ? " selected" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); applySelection(i); }}>
                  <span className="mention-name">{role.name}</span>
                  {role.description && <span className="mention-desc">{role.description}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="composer-actions button-row">
          {streamingMessage ? (
            <Button variant="destructive" onClick={() => handleInterrupt(streamingMessage.id)}>中断 Snail</Button>
          ) : (
            <Button onClick={handleSend} disabled={!canSend}>发送</Button>
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
