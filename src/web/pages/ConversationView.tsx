import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { MessageDto, Role, RuntimeUsage } from "../types";

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

const MessageItem = memo(function MessageItem({
  msg,
  stageId,
  onReply,
  onApprove,
  onDeny,
}: {
  msg: MessageDto;
  stageId: string;
  onReply: (id: number, preview: string) => void;
  onApprove: (stageId: string, msgId: number) => void;
  onDeny: (stageId: string, msgId: number) => void;
}) {
  const msgContent = extractMessageContent(msg);
  const roleName = extractRoleName(msg);
  const runtimeUsage = extractRuntimeUsage(msg);
  const hasContent = msgContent.processBlocks.length > 0 || msgContent.finalBlocks.length > 0;
  const shouldFoldProcess = !msgContent.isStreaming && msgContent.finalBlocks.length > 0;
  const isUser = msg.role === "user";

  return (
    <article id={`msg-${msg.id}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] min-w-0 flex ${isUser ? "flex-col items-end" : "items-start gap-[var(--space-sm)]"}`}>
        {!isUser && (
          <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-accent-blue)] to-[var(--color-accent-purple)] text-[11px] font-semibold text-[var(--color-bg-base)]">
            S
          </div>
        )}
        <div className={`flex min-w-0 flex-col ${isUser ? "items-end" : "items-start"}`}>
          <div className={`mb-1 flex items-center gap-[var(--space-sm)] px-1 text-[11px] text-[var(--color-text-grey)] ${isUser ? "flex-row-reverse" : ""}`}>
            <span className="font-medium text-[var(--color-text-secondary)]">{roleName}</span>
            <span className="[font-variant-numeric:tabular-nums]">{new Date(msg.created_at).toLocaleTimeString()}</span>
          </div>
          <div className={`min-w-0 rounded-2xl px-4 py-3 text-[13px] leading-relaxed shadow-sm [overflow-wrap:break-word] ${
            isUser
              ? "rounded-br-md border border-[rgba(108,141,250,0.24)] bg-[rgba(108,141,250,0.16)]"
              : "rounded-bl-md border border-[var(--color-border-muted)] bg-[var(--color-bg-surface)]"
          }${msgContent.isStreaming ? " border-[var(--color-accent-blue)]" : ""}`}>
            <div className="mb-[var(--space-xs)] flex items-center justify-end gap-[var(--space-sm)]">
              {runtimeUsage && (
                <span
                  className={`inline-flex max-w-[190px] items-center gap-[var(--space-xs)] whitespace-nowrap rounded-full border border-[rgba(125,211,252,0.22)] bg-[rgba(14,165,233,0.1)] px-[7px] py-[2px] text-[var(--font-size-xs)] text-[var(--color-text-cyan-muted)] [font-variant-numeric:tabular-nums]${runtimeUsage.isPlaceholder ? " border-dashed opacity-50" : ""}`}
                  title={runtimeUsage.title}
                >
                  <span className="min-w-0 overflow-hidden text-ellipsis">{runtimeUsage.label}</span>
                  <span className="font-bold text-[var(--color-warning-text)]">{runtimeUsage.percentLabel}</span>
                </span>
              )}
              <button className="rounded-md border border-[var(--color-border-muted)] bg-transparent px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]" onClick={() => onReply(msg.id, extractTextSummary(msg))}>回复</button>
            </div>
            <div className="whitespace-pre-wrap text-[var(--color-text-primary)]">
              {msg.quoted_message && (
                <blockquote className="mb-[var(--space-sm)] rounded-[var(--radius-sm)] border-l-[3px] border-l-[var(--color-accent)] bg-[var(--color-bg-elevated)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--font-size-sm)] leading-[var(--line-height-normal)] text-[var(--color-text-secondary)] whitespace-pre-wrap">
                  {msg.quoted_message.speaker && <strong>{msg.quoted_message.speaker}: </strong>}
                  {msg.quoted_message.preview || "(空消息)"}
                </blockquote>
              )}
              {!hasContent && msgContent.isStreaming && <ThinkingIndicator />}
              {!hasContent && !msgContent.isStreaming && null}
              {msgContent.processBlocks.length > 0 && (
                <EventStreamView blocks={msgContent.processBlocks} defaultOpen={!shouldFoldProcess || msgContent.containsQuestion}
                  onApprove={() => onApprove(stageId, msg.id)} onDeny={() => onDeny(stageId, msg.id)} />
              )}
              {msgContent.finalBlocks.map((block, i) => (
                <ContentBlockView key={i} block={block}
                  onApprove={() => onApprove(stageId, msg.id)} onDeny={() => onDeny(stageId, msg.id)} />
              ))}
              {msgContent.isStreaming && hasContent && <ThinkingIndicator className="mt-2" />}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
});

function ThinkingIndicator({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] ${className}`}>
      <div className="flex gap-0.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-accent)]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-accent)] [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-accent)] [animation-delay:300ms]" />
      </div>
      <span>thinking...</span>
    </div>
  );
}

interface Props { stageId: string | null; }

export function ConversationView({ stageId }: Props) {
  const queryClient = useQueryClient();
  const wsStatus = useConversationStore((s) => s.wsStatus);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; preview: string } | null>(null);
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const { mentionState, mentionStatus, inputRef, updateMention, handleKeyDown: handleMentionKeyDown, isMentionActive, applySelection } = useMention(availableRoles);

  const { data: stage } = useQuery({
    ...conversationQueries.detail(stageId || ""),
    enabled: !!stageId,
  });

  const { data: messages = [] } = useQuery({
    ...conversationQueries.messages(stageId || ""),
    enabled: !!stageId,
  });

  useEffect(() => {
    const roles = stage?.active_roles || stage?.role_instances || [];
    setAvailableRoles(roles.map((name) => ({ name })));
  }, [stage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || !stageId || sending) return;
    const content = input.trim();
    const optimisticId = Date.now();
    const optimisticMsg = createPlaceholderMessage(stageId, { id: optimisticId, role: "user", content });
    queryClient.setQueryData(queryKeys.stages.messages(stageId), (old: MessageDto[] | undefined) => [...(old ?? []), optimisticMsg]);
    setInput(""); setReplyTo(null); setSending(true);
    try {
      await api("POST /api/stages/:stageId/messages", { params: { stageId }, body: { text: content } });
      queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
    } catch (err: unknown) {
      showToast(`发送失败：${err instanceof Error ? err.message : String(err)}`, true);
      queryClient.setQueryData(queryKeys.stages.messages(stageId), (old: MessageDto[] | undefined) => old?.filter((m) => m.id !== optimisticId));
      queryClient.invalidateQueries({ queryKey: queryKeys.stages.detail(stageId) });
    }
    setSending(false);
  }

  async function handleInterrupt() {
    showToast("当前后端暂未提供中断接口", true);
  }

  const handlePermissionApprove = useCallback(async () => {
    showToast("当前后端暂未提供工具审批接口", true);
  }, []);

  const handlePermissionDeny = useCallback(async () => {
    showToast("当前后端暂未提供工具审批接口", true);
  }, []);

  const handleReply = useCallback((id: number, preview: string) => {
    setReplyTo({ id, preview });
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); handleSend(); return; }
    if (isMentionActive) { handleMentionKeyDown(e); return; }
  }

  const streamingMessage = useMemo(() => messages.find((m) => m.status === "streaming"), [messages]);
  const isAiRunning = !!streamingMessage;
  const canSend = input.trim() && !sending && !isAiRunning;

  if (!stageId) {
    return <div id="messages" className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-muted)]">选择一个 Stage</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-bg-base)]">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-6 py-6" ref={messagesContainerRef}>
        {messages.length === 0 && (
          <div className="m-auto flex max-w-[440px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-muted)] bg-[var(--color-bg-surface)] px-8 py-10 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(108,141,250,0.12)] text-[var(--color-accent)]">S</div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">还没有消息</div>
            <div className="mt-2 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              当前 Stage 已创建，等待你发送第一条消息。
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageItem
            key={msg.id}
            msg={msg}
            stageId={stageId}
            onReply={handleReply}
            onApprove={handlePermissionApprove}
            onDeny={handlePermissionDeny}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 px-6 pb-8 pt-4">
        {wsStatus !== "connected" && (
          <div className="mx-auto mb-2 flex max-w-[920px] items-center gap-2 rounded-md bg-[rgba(251,191,36,0.1)] px-3 py-2 text-[11px] text-[var(--color-warning-text)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-warning-text)]" />
            {wsStatus === "reconnecting" ? "Reconnecting..." : "Disconnected"}
          </div>
        )}
        <div className="relative mx-auto flex max-w-[920px] flex-col overflow-hidden rounded-2xl border border-[var(--color-border-muted)] bg-[var(--color-bg-surface)] shadow-sm transition-all focus-within:border-[rgba(108,141,250,0.45)] focus-within:ring-1 focus-within:ring-[rgba(108,141,250,0.16)]">
          {replyTo && (
            <div className="mx-3 mt-3 flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border-muted)] bg-[var(--color-bg-elevated)] px-[var(--space-md)] py-[var(--space-xs)] text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
              <div id="reply-banner-text" className="min-w-0 truncate">回复：{replyTo.preview}</div>
              <button className="ml-3 shrink-0 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" onClick={() => setReplyTo(null)}>取消</button>
            </div>
          )}
          <Textarea ref={inputRef} id="input" value={input} onChange={handleInputChange}
            placeholder="输入 @开发者 与指定 role 对话；未指定时默认发送给当前主 role" rows={1} onKeyDown={handleKeyDown}
            className="min-h-12 resize-none border-0 bg-transparent px-4 py-3 text-[13px] leading-relaxed shadow-none outline-none focus-visible:ring-0" />
          {isMentionActive && (
            <div className="absolute bottom-full left-[var(--space-md)] right-[var(--space-md)] z-10 mb-2 max-h-[220px] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-bg-elevated)] shadow-lg">
              {mentionState.suggestions.map((role, i) => (
                <div key={role.name} className={`flex cursor-pointer items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-xs)] text-[var(--font-size-sm)] ${
                  i === mentionState.selectedIndex ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-active)]"
                }`}
                  onMouseDown={(e) => { e.preventDefault(); applySelection(i); }}>
                  <span className="font-semibold">{role.name}</span>
                  {role.description && <span className="text-[var(--font-size-xs)] text-[var(--color-text-grey)]">{role.description}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-[var(--space-md)] border-t border-[var(--color-border-muted)] px-3 py-2">
            <div className="flex min-w-0 items-center gap-[var(--space-md)] text-[var(--font-size-xs)] text-[var(--color-text-grey)]">
              <span>Shift+Enter 发送</span>
              {mentionStatus && <span className="truncate text-[var(--color-accent)]">{mentionStatus}</span>}
            </div>
            <div className="flex shrink-0 gap-[var(--space-xs)]">
              {streamingMessage ? (
                <Button variant="destructive" onClick={() => handleInterrupt()}>中断 Snail</Button>
              ) : (
                <Button onClick={handleSend} disabled={!canSend}>发送</Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
