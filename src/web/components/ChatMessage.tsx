import { useState } from "react";
import { formatDateTime } from "@/lib/utils";
import type { MessageWithEvents, MessageEvent, MessageContext } from "@/types";

function extractAllText(events: MessageEvent[]): string {
  return events
    .filter((e) => e.kind === "text" && e.payload && "text" in e.payload)
    .map((e) => (e.payload as { text: string }).text)
    .join("");
}

function extractContextUsage(events: MessageEvent[]): { label: string; percent: number } | null {
  for (const event of events) {
    if (event.kind === "signal" && event.payload && "type" in event.payload) {
      const p = event.payload as { type: string; detail?: Record<string, unknown> };
      if (p.type === "runtime_usage" && p.detail) {
        const d = p.detail as { context_window?: number; context_usage?: number };
        if (d.context_window && d.context_usage) {
          const percent = Math.round((d.context_usage / d.context_window) * 100);
          return { label: `${Math.round(d.context_usage / 1000)}k/${Math.round(d.context_window / 1000)}k`, percent };
        }
      }
    }
  }
  return null;
}

export function ChatMessage({ message }: { message: MessageWithEvents }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";

  if (isSystem) {
    const text = extractAllText(message.events);
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

  const contextUsage = extractContextUsage(message.events);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] flex ${isUser ? "flex-col items-end" : "items-start gap-2"}`}>
        {/* Agent avatar */}
        {!isUser && (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-shell-500 to-shell-700 flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            </svg>
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Header */}
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

          {/* Event stream (collapsible) */}
          {isAssistant && <EventStream events={message.events} />}

          {/* Final answer bubble */}
          <div className={`rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${
            isUser
              ? "rounded-br-md bg-shell-600/20 border border-shell-600/20"
              : "rounded-bl-md bg-surface-2 border border-white/6"
          }`}>
            <MessageContent events={message.events} context={message.context} />
          </div>

          {/* Streaming indicator */}
          {message.status === "streaming" && (
            <div className="flex items-center gap-1.5 mt-1 px-1">
              <div className="flex gap-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-shell-400 animate-bounce" />
                <div className="w-1.5 h-1.5 rounded-full bg-shell-400 animate-bounce [animation-delay:150ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-shell-400 animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-[11px] text-text-muted">thinking...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Collapsible event stream: tool calls, commands */
function EventStream({ events }: { events: MessageEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const streamEvents = events.filter((e) =>
    e.kind === "tool_call" || e.kind === "tool_result" || e.kind === "command" || e.kind === "command_result"
  );

  if (streamEvents.length === 0) return null;

  const toolCalls = streamEvents.filter((e) => e.kind === "tool_call").length;
  const commands = streamEvents.filter((e) => e.kind === "command").length;

  return (
    <div className="mb-2">
      {/* Toggle bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors w-full"
      >
        <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 18 6-6-6-6"/>
        </svg>
        <span>
          {toolCalls > 0 && `${toolCalls} tool call${toolCalls > 1 ? "s" : ""}`}
          {toolCalls > 0 && commands > 0 && " · "}
          {commands > 0 && `${commands} command${commands > 1 ? "s" : ""}`}
        </span>
      </button>

      {/* Expanded events */}
      {expanded && (
        <div className="space-y-1 pl-3 border-l-2 border-white/6 ml-3 mt-1">
          {streamEvents.map((event) => (
            <EventItem key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventItem({ event }: { event: MessageEvent }) {
  if (event.kind === "tool_call") {
    const p = event.payload as { tool_name: string; title?: string | null };
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[12px]">
        <svg className="w-3.5 h-3.5 text-shell-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
        <span className="text-text-secondary font-mono text-[11px]">{p.tool_name}</span>
        {p.title && <span className="text-text-muted text-[11px] truncate">{p.title}</span>}
      </div>
    );
  }

  if (event.kind === "tool_result") {
    const p = event.payload as { tool_name: string; is_error: boolean };
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[12px]">
        {p.is_error ? (
          <svg className="w-3.5 h-3.5 text-status-red shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-status-green shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
        <span className="text-text-secondary font-mono text-[11px]">{p.tool_name}</span>
        <span className={`text-[11px] ${p.is_error ? "text-status-red" : "text-text-muted"}`}>{p.is_error ? "failed" : "done"}</span>
      </div>
    );
  }

  if (event.kind === "command") {
    const p = event.payload as { command: string };
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[12px]">
        <svg className="w-3.5 h-3.5 text-status-teal shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        <span className="text-text-secondary font-mono text-[11px] truncate">{p.command}</span>
      </div>
    );
  }

  if (event.kind === "command_result") {
    const p = event.payload as { command: string; is_error: boolean; exit_code?: number | null };
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[12px]">
        <svg className="w-3.5 h-3.5 text-status-teal shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        <span className="text-text-secondary font-mono text-[11px] truncate">{p.command}</span>
        <span className={`text-[11px] ${p.is_error ? "text-status-red" : "text-text-muted"}`}>
          {p.is_error ? `exit ${p.exit_code ?? "?"}` : "ok"}
        </span>
      </div>
    );
  }

  return null;
}

function MessageContent({ events, context }: { events: MessageEvent[]; context: MessageContext | null }) {
  const textParts: string[] = [];
  for (const event of events) {
    if (event.kind === "text" && event.payload && "text" in event.payload) {
      textParts.push((event.payload as { text: string }).text);
    }
  }
  const text = textParts.join("");

  if (context?.context) {
    return <div className="text-text-primary whitespace-pre-wrap">{context.context}</div>;
  }
  if (!text) return <span className="text-text-muted italic">No content</span>;
  return <div className="text-text-primary whitespace-pre-wrap">{text}</div>;
}
