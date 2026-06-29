import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "@/lib/utils";
import { RichTextRenderer } from "@/components/RichTextRenderer";
import { showToast } from "@/components/Toast";
import type { MessageDto, MessageEvent } from "@/types";

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

function ChatMessageInner({ message, onInterrupt }: { message: MessageDto; onInterrupt?: (messageId: number) => Promise<void> }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const [expandedByUser, setExpandedByUser] = useState<boolean | null>(null);
  const [interrupting, setInterrupting] = useState(false);
  const interruptingRef = useRef(false);

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
        console.warn(`[StuckDetector] message #${message.id} stuck in streaming for ${Math.round(elapsed / 1000)}s`, {
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
                <span className="text-[12px] font-medium text-text-secondary">{message.from_role ?? "Agent"}</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-shell-600/20 text-shell-400">AI</span>
              </>
            )}
            <span className="text-[11px] text-text-muted">{formatDateTime(message.created_at)}</span>
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
          <div className={`relative rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${hasContext ? "pr-24" : ""} ${
            isUser
              ? "rounded-br-md bg-shell-600/20 border border-shell-600/20"
              : isStreaming
                ? "rounded-bl-md bg-surface-2 border border-shell-500/50 shadow-[0_0_12px_rgba(214,138,62,0.15)]"
                : "rounded-bl-md bg-surface-2 border border-white/6"
          }`}>
            {/* 来源标签：absolute 定位避免 badge 占据内容流空间，right-3 与 contextUsage badge 视觉对齐 */}
            {hasContext && (
              <span className="absolute top-2 right-3 select-none text-[10px] text-text-grey font-mono">
                {message.context!.kind}
              </span>
            )}
            {hasContext ? (
              <RichTextRenderer content={message.context!.context} />
            ) : message.content ? (
              <RichTextRenderer content={message.content} />
            ) : isStreaming ? (
              <EventTextContent events={message.events} />
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
              <span className="text-[11px] text-shell-400">AI is responding...</span>
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
                AI 已长时间无新事件，可能是 WebSocket 断连或后端异常。事件数: {message.events.length}，消息 ID: #{message.id}
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

/** 流式过程中从 events 提取 text 事件拼接展示，用于最终答复区在 context 和 content 都为空时的 fallback */
function EventTextContent({ events }: { events: MessageEvent[] }) {
  const text = useMemo(() => {
    return events
      .filter((e) => e.payload?.type === "text" && e.payload && "text" in e.payload)
      .map((e) => (e.payload as unknown as { text: string }).text)
      .join("");
  }, [events]);

  if (!text) return <span className="text-text-muted italic">（无文本输出）</span>;
  return <RichTextRenderer content={text} />;
}

/** 流式过程折叠区：展示除 text 外的事件类型（text 已在最终答复区展示），流式过程和最终答复是两个独立展示区域 */
function EventStream({ events, expanded, onToggle }: { events: MessageEvent[]; expanded: boolean; onToggle: () => void }) {
  /** 过滤 text events（已在最终答复区展示），减少 EventStream 渲染量 */
  const { filteredEvents, toolCalls, commands } = useMemo(() => {
    const filtered = events.filter((e) => e.payload?.type !== "text");
    return {
      filteredEvents: filtered,
      toolCalls: filtered.filter((e) => e.payload?.type === "tool_call").length,
      commands: filtered.filter((e) => e.payload?.type === "command").length,
    };
  }, [events]);

  return (
    <div className="mb-2">
      {/* streaming 期间无非 text events 时不显示摘要行，展开区域留空 */}
      {filteredEvents.length > 0 && (
        <button
          onClick={onToggle}
          aria-label={expanded ? "Collapse event stream" : "Expand event stream"}
          className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors w-full"
        >
          <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
          <span>
            {filteredEvents.length} event{filteredEvents.length > 1 ? "s" : ""}
            {toolCalls > 0 && ` · ${toolCalls} tool call${toolCalls > 1 ? "s" : ""}`}
            {commands > 0 && ` · ${commands} command${commands > 1 ? "s" : ""}`}
          </span>
        </button>
      )}

      {expanded && filteredEvents.length > 0 && (
        <div className="space-y-1 pl-3 border-l-2 border-white/6 ml-3 mt-1">
          {filteredEvents.map((event) => (
            <EventItem key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 截断文本到指定 Unicode 字符数，超出显示 ... */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/** 从 tool_input 派生 tool_call 摘要文本。返回 null 表示无法派生（降级到仅显示工具名）。 */
function deriveToolCallSummary(toolName: string, input: unknown): string | null {
  if (input == null || typeof input !== "object") return null;
  const inp = input as Record<string, unknown>;

  // 已知工具：结构化提取
  switch (toolName) {
    case "Bash":
      return typeof inp.command === "string" ? inp.command : null;
    case "Read": {
      if (typeof inp.file_path !== "string") return null;
      const offset = typeof inp.offset === "number" ? inp.offset : null;
      const limit = typeof inp.limit === "number" ? inp.limit : null;
      if (offset != null && limit != null) {
        return `${inp.file_path} L${offset}-${offset + limit}`;
      }
      return inp.file_path;
    }
    case "Edit":
    case "Write":
      return typeof inp.file_path === "string" ? inp.file_path : null;
    case "Glob":
      return typeof inp.pattern === "string" ? inp.pattern : null;
    case "Grep": {
      if (typeof inp.pattern !== "string") return null;
      return typeof inp.path === "string" ? `${inp.pattern} in ${inp.path}` : inp.pattern;
    }
    case "Agent":
      return typeof inp.prompt === "string" ? inp.prompt : null;
    case "WebFetch":
      return typeof inp.url === "string" ? inp.url : null;
    case "WebSearch":
      return typeof inp.query === "string" ? inp.query : null;
    case "TodoWrite": {
      const todos = Array.isArray(inp.todos) ? inp.todos : null;
      return todos ? `${todos.length} item${todos.length !== 1 ? "s" : ""}` : null;
    }
    case "Skill":
      return typeof inp.skill === "string" ? inp.skill : null;
  }

  // MCP 工具：mcp__<server>__<tool> 格式 → 显示 server.tool
  // 摘要：取 Object.values 中第一个 string 值
  if (toolName.startsWith("mcp__")) {
    return extractFirstStringValue(inp);
  }

  // 未知工具：取 Object.values 中第一个 string 值
  return extractFirstStringValue(inp);
}

/** 从对象中提取第一个 typeof === 'string' 的 value，无则降级到 JSON.stringify（不截断，由调用方处理） */
function extractFirstStringValue(obj: Record<string, unknown>): string | null {
  for (const val of Object.values(obj)) {
    if (typeof val === "string") return val;
  }
  // 无 string 值：降级到 JSON.stringify
  try {
    const json = JSON.stringify(obj);
    if (!json || json === "{}") return null;
    return json;
  } catch {
    return null;
  }
}

/** 解析 MCP 工具名为 server.tool 格式 */
function parseMcpToolName(toolName: string): string {
  // mcp__<server>__<tool> → server.tool
  const parts = toolName.split("__");
  if (parts.length >= 3 && parts[0] === "mcp") {
    return `${parts[1]}.${parts.slice(2).join("__")}`;
  }
  return toolName;
}

function EventItem({ event }: { event: MessageEvent }) {
  const [expanded, setExpanded] = useState(false);
  const type = event.payload?.type;
  const p = event.payload as Record<string, unknown>;

  let label: string;
  let tag: string;
  let tagClass: string;
  let detail: string | null = null;
  let showDetail = false;

  switch (type) {
    case "tool_call": {
      const toolName = p.tool_name as string;
      const toolInput = p.tool_input as unknown;
      const summary = deriveToolCallSummary(toolName, toolInput);
      // MCP 工具名解析为 server.tool 格式用于显示
      const displayToolName = toolName.startsWith("mcp__") ? parseMcpToolName(toolName) : toolName;
      label = summary ? `${displayToolName} · ${truncateText(summary, 60)}` : displayToolName;
      tag = "Tool";
      tagClass = "bg-shell-600/30 text-shell-300";
      try { detail = toolInput ? JSON.stringify(toolInput, null, 2) : null; } catch { detail = null; }
      // 偏离 B6 字面规范：当 toolInput 非空但 summary 提取失败时仍保留展开箭头，
      // 让用户可检视原始 JSON（调试价值 > 完全隐藏）
      showDetail = !!summary || !!toolInput;
      break;
    }
    case "tool_result": {
      const toolName = p.tool_name as string;
      const isError = p.is_error as boolean;
      label = toolName;
      tag = isError ? "Failed" : "Done";
      tagClass = isError ? "bg-status-red/20 text-status-red" : "bg-status-green/20 text-status-green";
      break;
    }
    case "command": {
      const cmd = p.command as string;
      label = truncateText(cmd, 60);
      tag = "Cmd";
      tagClass = "bg-status-teal/20 text-status-teal";
      detail = cmd;
      showDetail = cmd.length > 60;
      break;
    }
    case "command_result": {
      const cmd = p.command as string;
      const isError = p.is_error as boolean;
      const exitCode = p.exit_code as number | null | undefined;
      label = truncateText(cmd, 60);
      tag = isError ? "Cmd Failed" : "Cmd OK";
      tagClass = isError ? "bg-status-red/20 text-status-red" : "bg-status-green/20 text-status-green";
      detail = isError
        ? `exit ${exitCode ?? "?"}\n${cmd}`
        : cmd;
      showDetail = cmd.length > 60 || isError;
      break;
    }
    case "text": {
      const text = p.text as string;
      label = truncateText(text, 60);
      tag = "Text";
      tagClass = "bg-surface-3 text-text-secondary";
      detail = text;
      showDetail = text.length > 60;
      break;
    }
    case "signal": {
      const signal = p.signal as string;
      const detailObj = (p.detail ?? p) as Record<string, unknown>;
      if (signal === "runtime_usage") {
        const contextWindow = Number(detailObj.context_window ?? detailObj.contextWindow ?? 0);
        const usageRatio = Number(detailObj.context_usage_ratio ?? 0);
        if (contextWindow && usageRatio) {
          const used = contextWindow * usageRatio;
          const percent = Math.round(usageRatio * 100);
          label = `${signal}: ${Math.round(used / 1000)}k/${Math.round(contextWindow / 1000)}k (${percent}%)`;
        } else {
          label = signal;
        }
      } else {
        label = signal;
      }
      tag = "Signal";
      tagClass = "bg-status-amber/20 text-status-amber";
      break;
    }
    case "error": {
      const msg = (p.message ?? p.error ?? "Unknown error") as string;
      label = truncateText(msg, 60);
      tag = "Error";
      tagClass = "bg-status-red/20 text-status-red";
      detail = msg;
      showDetail = true;
      break;
    }
    default:
      return null;
  }

  return (
    <div className="px-2 py-1 text-[12px]">
      <div className="flex items-center gap-2">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-medium shrink-0 ${tagClass}`}>
          {tag}
        </span>
        <span className="text-text-secondary text-[11px] truncate">{label}</span>
        {showDetail && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-text-muted hover:text-text-secondary transition-colors shrink-0"
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        )}
      </div>
      {showDetail && expanded && detail && (
        <div className="mt-1 ml-6 pl-2 border-l border-white/10 text-[11px] text-text-muted font-mono whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
          {detail}
        </div>
      )}
    </div>
  );
}
