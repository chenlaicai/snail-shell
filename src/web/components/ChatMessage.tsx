import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { RichTextRenderer } from "@/components/RichTextRenderer";
import { EventStream } from "@/components/EventTimeline";
import { showToast } from "@/components/Toast";
import { useLiveTimer } from "@/hooks/useLiveTimer";
import { getLogger } from "@/lib/logger";
import type { MessageDto, MessageEvent } from "@/types";

const log = getLogger("StuckDetector");

/** streaming 超时阈值：超过此时间无新事件视为 stuck（ms） */
const STUCK_THRESHOLD_MS = 90_000;

function extractContextUsage(events: MessageEvent[]): { label: string; percent: number } | null {
  for (const event of events) {
    // signal 类型事件的 payload 结构为 { type: "signal", signal: "<signal_type>", ... }
    const payload = event.payload as unknown as { signal?: string; detail?: Record<string, unknown> };
    if (event.payload?.type === "signal" && payload.signal === "runtime_usage") {
      if (payload.detail) {
        const d = payload.detail;
        const contextWindow = Number(d.context_window ?? d.contextWindow ?? 0);
        const contextUsageRatio = Number(d.context_usage_ratio ?? 0);
        if (contextWindow && contextUsageRatio) {
          const contextUsage = contextWindow * contextUsageRatio;
          const percent = Math.round(contextUsageRatio * 100);
          return { label: `${Math.round(contextUsage / 1000)}k/${Math.round(contextWindow / 1000)}k`, percent };
        }
      }
    }
  }
  return null;
}

function ChatMessageInner({ message, onInterrupt, onRetry }: { message: MessageDto; onInterrupt?: (messageId: number) => Promise<void>; onRetry?: () => void }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const [expandedByUser, setExpandedByUser] = useState<boolean | null>(null);
  const [interrupting, setInterrupting] = useState(false);
  const interruptingRef = useRef(false);
  const isSending = message.status === "sending";
  const isFailed = message.status === "failed";

  const handleStop = useCallback(async () => {
    if (interruptingRef.current || !onInterrupt) return;
    interruptingRef.current = true;
    setInterrupting(true);
    try {
      await onInterrupt(message.id);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "already-completed") {
        showToast("该消息已完成", false);
      } else {
        showToast(`中断请求失败：${err instanceof Error ? err.message : String(err)}`, true);
      }
      setInterrupting(false);
    } finally {
      interruptingRef.current = false;
    }
  }, [onInterrupt, message.id]);

  if (isSystem) {
    const text = message.events
      .filter((e) => e.payload?.type === "text" && e.payload && "text" in e.payload)
      .map((e) => (e.payload as unknown as { text: string }).text)
      .join("");
    return (
      <div className="flex justify-center py-1">
        <div className="flex items-center gap-2 text-[12px] text-text-muted bg-surface-2 rounded-full px-3 py-1">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span className="text-text-secondary">{message.from_role ?? "System"}</span>
          <span>{text}</span>
          <span className="text-text-grey">{formatDateTime(message.created_at)}</span>
        </div>
      </div>
    );
  }

  const contextUsage = useMemo(() => extractContextUsage(message.events), [message.events]);
  const isStreaming = message.status === "streaming";
  const elapsedMs = useLiveTimer(message, isStreaming);
  const hasContext = !!message.context?.context;
  const hasEvents = message.events.length > 0;

  // ── Stuck-streaming 检测 ──
  const [isStuck, setIsStuck] = useState(false);
  const stuckCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isStreaming) { setIsStuck(false); return; }
    const check = () => {
      const lastActivity = message._lastEventAt ?? new Date(message.created_at).getTime();
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= STUCK_THRESHOLD_MS) {
        setIsStuck(true);
        log.warn(`message #${message.id} stuck in streaming for ${Math.round(elapsed / 1000)}s`, {
          messageId: message.id, status: message.status, eventCount: message.events.length,
          lastEventAt: message._lastEventAt, createdAt: message.created_at,
        });
      } else {
        setIsStuck(false);
        stuckCheckRef.current = setTimeout(check, STUCK_THRESHOLD_MS - elapsed + 1000);
      }
    };
    check();
    return () => { if (stuckCheckRef.current) clearTimeout(stuckCheckRef.current); };
  }, [isStreaming, message]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] flex ${isUser ? "flex-col items-end" : "items-start gap-2"}`}>
        {!isUser && (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-shell-500 to-shell-700 flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            </svg>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className={`flex items-center gap-2 mb-1 px-1 ${isUser ? "justify-end" : "flex-wrap"}`}>
            {!isUser && (
              <>
                <span className="text-[12px] font-medium text-text-secondary">{message.from_role ?? "Snail"}</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-shell-600/20 text-shell-400">Snail</span>
              </>
            )}
            <span className="text-[11px] text-text-muted">{formatDateTime(message.created_at)}</span>
            {!isUser && elapsedMs > 0 && (
              <span className={`text-[11px] ${isStreaming ? "text-shell-400" : "text-text-muted"}`}>
                {formatDuration(elapsedMs)}
              </span>
            )}
            {contextUsage && (
              <span className="inline-flex items-center gap-1 text-[10px] text-text-grey font-mono">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                {contextUsage.label}
                <span className={`${contextUsage.percent > 80 ? "text-status-red" : contextUsage.percent > 60 ? "text-status-amber" : "text-text-muted"}`}>
                  ({contextUsage.percent}%)
                </span>
              </span>
            )}
            {isUser && (
              <>
                <span className="text-[12px] font-medium text-text-secondary">{message.from_role ?? "User"}</span>
                <div className="w-7 h-7 rounded-full bg-shell-600 flex items-center justify-center text-[11px] font-medium text-white shrink-0">
                  {(message.from_role ?? "U").charAt(0)}
                </div>
              </>
            )}
          </div>
          {isUser && isFailed && (
            <div className="flex justify-end px-1 mb-1">
              <span className="inline-flex items-center gap-1 text-[10px] text-status-red">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
                发送失败
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-status-red/15 text-status-red border border-status-red/30 hover:bg-status-red/25 transition-colors"
                  >
                    重试
                  </button>
                )}
              </span>
            </div>
          )}

          {/* hasContext 已移除：失败/中断时也需要展示 EventStream 用于诊断（D4） */}
          {hasEvents && (
            <EventStream
              events={message.events}
              expanded={expandedByUser !== null ? expandedByUser : isStreaming}
              onToggle={() => setExpandedByUser((prev) => !prev)}
            />
          )}

          {/* 最终答复：优先 context，其次 content，否则显示空状态提示 */}
          {/* hasContext 时预留 pr-24 给来源标签，避免长文本与 badge 重叠（最长 kind mcp_final_body ~84px + right-3 12px = 96px） */}
          <div className={`group relative rounded-2xl px-4 py-3 ml-6 text-[13px] leading-relaxed ${hasContext ? "pr-24" : ""} ${
            isUser
              ? isSending
                ? "rounded-br-md bg-shell-600/10 border border-shell-600/10 opacity-70"
                : isFailed
                  ? "rounded-br-md bg-status-red/10 border border-status-red/20"
                  : "rounded-br-md bg-shell-600/20 border border-shell-600/20"
              : isStreaming
                ? "rounded-bl-md bg-surface-2 border border-shell-500/50 shadow-[0_0_12px_rgba(214,138,62,0.15)]"
                : "rounded-bl-md bg-surface-2 border border-white/6"
          }`}>
            {/* 发送中 spinner：absolute 定位相对于气泡，不占 flex 流空间，出现/消失不引起布局跳动 */}
            {isUser && isSending && (
              <svg className="absolute top-1/2 -translate-y-1/2 -left-6 w-3.5 h-3.5 animate-spin text-shell-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4m0 12v4m-8-10H2m20 0h-2m-2.93-7.07l-1.41 1.41M7.05 16.95l-1.41 1.41m0-13.41l1.41 1.41m9.9 9.9l1.41 1.41" />
              </svg>
            )}
            {/* 来源标签：absolute 定位避免 badge 占据内容流空间，right-3 与 contextUsage badge 视觉对齐 */}
            {hasContext && (
              <span className="absolute top-2 right-3 select-none text-[10px] text-text-grey font-mono">
                {message.context!.kind}
              </span>
            )}
            {/* 复制按钮：hover 时显示，streaming 时隐藏 */}
            {!isStreaming && (
              <button
                onClick={() => {
                  /** 复制内容源：assistant 优先 context.context，fallback content；user 用 content */
                  const text = hasContext ? message.context!.context : message.content;
                  if (!text) return;
                  navigator.clipboard.writeText(text).then(
                    () => showToast("Copied"),
                    () => showToast("复制失败", true),
                  );
                }}
                className={`absolute top-2 ${hasContext ? "right-24" : "right-10"} opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10 text-text-muted hover:text-text-secondary`}
                aria-label="Copy message"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
            {hasContext ? (
              <RichTextRenderer content={message.context!.context} />
            ) : message.content ? (
              <RichTextRenderer content={message.content} />
            ) : (
              <span className="text-text-muted italic">（无文本输出）</span>
            )}
            {isStreaming && <span className="inline-block w-[2px] h-[14px] bg-shell-400 ml-0.5 align-text-bottom animate-blink" />}
          </div>

          {isStreaming && !isStuck && (
            <div className="flex items-center gap-1.5 mt-1.5 px-1">
              <div className="flex gap-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-shell-400 animate-bounce" />
                <div className="w-1.5 h-1.5 rounded-full bg-shell-400 animate-bounce [animation-delay:150ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-shell-400 animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-[11px] text-shell-400">Snail is responding...</span>
              {onInterrupt && (
                <button
                  onClick={handleStop}
                  disabled={interrupting}
                  className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${interrupting
                    ? "bg-status-red/10 text-status-red/60 border border-status-red/20 cursor-not-allowed"
                    : "bg-status-red/15 text-status-red border border-status-red/30 hover:bg-status-red/25"
                  }`}
                >
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                  {interrupting ? "Stopping..." : "Stop"}
                </button>
              )}
            </div>
          )}

          {isStreaming && isStuck && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-status-amber/10 border border-status-amber/20">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-3.5 h-3.5 text-status-amber shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span className="text-[11px] font-medium text-status-amber">响应可能已中断</span>
              </div>
              <p className="text-[10px] text-text-muted leading-relaxed">
                Snail 已长时间无新事件，可能是 WebSocket 断连或后端异常。事件数: {message.events.length}，消息 ID: #{message.id}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                {onInterrupt && (
                  <button
                    onClick={handleStop}
                    disabled={interrupting}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${interrupting
                      ? "bg-status-red/10 text-status-red/60 border border-status-red/20 cursor-not-allowed"
                      : "bg-status-red/15 text-status-red border border-status-red/30 hover:bg-status-red/25"
                    }`}
                  >
                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                    {interrupting ? "Stopping..." : "Stop"}
                  </button>
                )}
                <button
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-surface-3 text-text-secondary border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
                  </svg>
                  Refresh
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const ChatMessage = React.memo(ChatMessageInner, (prev, next) => {
  if (prev.message.id !== next.message.id) return false;
  if (prev.message.status !== next.message.status) return false;
  if (prev.message.content !== next.message.content) return false;
  if (prev.message.context !== next.message.context) return false;
  if (prev.onInterrupt !== next.onInterrupt) return false;
  if (prev.onRetry !== next.onRetry) return false;
  /** _lastEventAt 变化时需重渲染以更新 stuck-streaming 检测 */
  if (prev.message._lastEventAt !== next.message._lastEventAt) return false;
  /** 轻量事件比较：length + 最后事件 ID，避免引用比较在结构共享失败时误判 */
  const prevEvents = prev.message.events;
  const nextEvents = next.message.events;
  if (prevEvents === nextEvents) return true;
  if (prevEvents.length !== nextEvents.length) return false;
  if (prevEvents.length === 0) return true;
  return prevEvents[prevEvents.length - 1].id === nextEvents[nextEvents.length - 1].id;
});
