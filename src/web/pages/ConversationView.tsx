import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api-client";
import { conversationQueries } from "../queries/conversation.queries";
import { queryKeys } from "../queries/keys";
import { createPlaceholderMessage } from "../hooks/useWebSocket";
import { showToast } from "../components/Toast";
import { extractMessageContent, EventStreamView, ContentBlockView } from "../components/MessageRenderer";
import { useMention } from "../hooks/useMention";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { MessageDto, ConversationDetailDto, Role, RuntimeUsage } from "../types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

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
  const rawDetail = usageEvents.at(-1)?.payload?.detail;
  const detail = isRecord(rawDetail) ? rawDetail : undefined;
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
    const optimisticMsg = createPlaceholderMessage(conversationId, { id: optimisticId, role: "user", content });
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
    return <div id="messages" className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">选择一个 Conversation</div>;
  }

  return (
    <>
      <div id="messages" className="flex-1 overflow-auto p-6" ref={messagesContainerRef}>
        {messages.length === 0 && <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无消息</div>}
        {messages.map((msg) => {
          const msgContent = extractMessageContent(msg);
          const roleName = extractRoleName(msg);
          const runtimeUsage = extractRuntimeUsage(msg);
          const hasContent = msgContent.processBlocks.length > 0 || msgContent.finalBlocks.length > 0;
          const shouldFoldProcess = !msgContent.isStreaming && msgContent.finalBlocks.length > 0;
          return (
            <div
              key={msg.id}
              id={`msg-${msg.id}`}
              className={`msg max-w-[var(--message-max-width)] px-[14px] py-[var(--space-md)] rounded-[14px] leading-[1.6] whitespace-pre-wrap min-w-0 [overflow-wrap:break-word] ${
                msg.role === "user"
                  ? "self-end bg-[var(--color-user-msg-bg)] border border-[var(--color-border-muted)] rounded-br-[var(--space-2xs)]"
                  : msg.role === "assistant"
                  ? "self-start bg-[var(--color-assistant-msg-bg)] border border-[var(--color-border-muted)] rounded-bl-[var(--space-2xs)]"
                  : ""
              }${msgContent.isStreaming ? " border-[var(--color-accent-blue)] border-dashed" : ""}`}
            >
              <div className="flex items-center justify-between gap-[var(--space-md)] mb-[var(--space-2xs)]">
                <div className="text-[var(--font-size-xs)] text-[var(--color-text-blue-muted)] uppercase tracking-[0.08em]">{roleName}</div>
                <div className="flex items-center justify-end gap-[var(--space-sm)] min-w-0">
                  {runtimeUsage && (
                    <span
                      className={`inline-flex items-center gap-[var(--space-xs)] max-w-[190px] px-[7px] py-[2px] border border-[rgba(125,211,252,0.22)] rounded-full bg-[rgba(14,165,233,0.1)] text-[var(--color-text-cyan-muted)] text-[var(--font-size-xs)] not-italic [font-variant-numeric:tabular-nums] whitespace-nowrap${runtimeUsage.isPlaceholder ? " opacity-50 border-dashed" : ""}`}
                      title={runtimeUsage.title}
                    >
                      <span className="min-w-0 overflow-hidden text-ellipsis">{runtimeUsage.label}</span>
                      <span className="text-[var(--color-warning-text)] font-bold">{runtimeUsage.percentLabel}</span>
                    </span>
                  )}
                  <div className="shrink-0 text-[var(--font-size-xs)] text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">{new Date(msg.created_at).toLocaleTimeString()}</div>
                  <button className="bg-transparent text-[var(--color-text-secondary)] border border-[var(--color-border-muted)] rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-all hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]" style={{ fontSize: "10px", padding: "2px 6px" }} onClick={() => setReplyTo({ id: msg.id, preview: extractTextSummary(msg) })}>回复</button>
                </div>
              </div>
              <div className="whitespace-pre-wrap">
                {msg.quoted_message && (
                  <blockquote className="mb-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] border-l-[3px] border-l-[var(--color-accent)] bg-[var(--color-bg-elevated)] rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] text-[var(--font-size-sm)] leading-[var(--line-height-normal)] whitespace-pre-wrap">
                    {msg.quoted_message.speaker && <strong>{msg.quoted_message.speaker}: </strong>}
                    {msg.quoted_message.preview || "(空消息)"}
                  </blockquote>
                )}
                {!hasContent && msgContent.isStreaming && (
                  <div className="flex items-center gap-[var(--space-md)] text-[var(--color-text-blue-muted)] text-[var(--font-size-base)] not-italic">
                    <div className="relative shrink-0 basis-[54px] h-5 overflow-hidden border-b border-dotted border-b-[rgba(191,219,254,0.52)]">
                      <span className="absolute left-0 -bottom-0.5 inline-block text-[var(--font-size-2xl)] leading-none animate-[snail-crawl_1.8s_ease-in-out_infinite]">🐌</span>
                    </div>
                    <span>Snail is starting</span>
                  </div>
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
                  <div className="flex items-center gap-[var(--space-md)] text-[var(--color-text-blue-muted)] text-[var(--font-size-base)] not-italic">
                    <div className="relative shrink-0 basis-[54px] h-5 overflow-hidden border-b border-dotted border-b-[rgba(191,219,254,0.52)]">
                      <span className="absolute left-0 -bottom-0.5 inline-block text-[var(--font-size-2xl)] leading-none animate-[snail-crawl_1.8s_ease-in-out_infinite]">🐌</span>
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

      <div className="border-t border-[var(--color-border-muted)] bg-[var(--color-bg-base)] p-[var(--space-md)] px-[var(--space-lg)] shrink-0">
        {replyTo && (
          <div className="flex items-center justify-between mb-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-xs)] bg-[var(--color-bg-elevated)] rounded-[var(--radius-sm)] text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
            <div id="reply-banner-text">回复：{replyTo.preview}</div>
            <button className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-xs" onClick={() => setReplyTo(null)}>取消</button>
          </div>
        )}
        <div className="flex flex-col gap-[var(--space-xs)]">
          <Textarea ref={inputRef} id="input" value={input} onChange={handleInputChange}
            placeholder="输入 @开发者 与指定 role 对话；未指定时默认发送给当前主 role" rows={2} onKeyDown={handleKeyDown} />
          <div className="flex items-center gap-[var(--space-md)] text-[var(--font-size-xs)] text-[var(--color-text-grey)]">
            <span>Shift+Enter 发送</span>
            {mentionStatus && <span className="text-[var(--color-accent)]">{mentionStatus}</span>}
          </div>
          {isMentionActive && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-muted)] rounded-[var(--radius-md)] shadow-lg max-h-[200px] overflow-auto z-10">
              {mentionState.suggestions.map((role, i) => (
                <div key={role.name} className={`flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-xs)] cursor-pointer text-[var(--font-size-sm)] ${
                  i === mentionState.selectedIndex ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                }`}
                  onMouseDown={(e) => { e.preventDefault(); applySelection(i); }}>
                  <span className="font-semibold">{role.name}</span>
                  {role.description && <span className="text-[var(--color-text-grey)] text-[var(--font-size-xs)]">{role.description}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="composer-actions flex gap-[var(--space-xs)] flex-wrap">
          {streamingMessage ? (
            <Button variant="destructive" onClick={() => handleInterrupt(streamingMessage.id)}>中断 Snail</Button>
          ) : (
            <Button onClick={handleSend} disabled={!canSend}>发送</Button>
          )}
        </div>
        <div className="text-[11px] text-[var(--color-text-grey)] px-6">
          {wsStatus === "connected" && <span className="text-[var(--color-accent-cyan)]">● 已连接</span>}
          {wsStatus === "disconnected" && <span className="text-[var(--color-danger-text)]">● 已断开</span>}
          {wsStatus === "reconnecting" && <span className="text-[var(--color-warning-soft)]">● 重连中...</span>}
        </div>
      </div>
    </>
  );
}
