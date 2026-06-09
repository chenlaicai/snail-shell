import { formatRelativeTime } from "@/lib/utils";
import type { MessageWithEvents, MessageEvent } from "@/types";

function extractText(events: MessageEvent[]): string {
  for (const event of events) {
    if (event.kind === "text" && event.payload && "text" in event.payload) {
      return (event.payload as { text: string }).text;
    }
  }
  return "";
}

export function ChatMessage({ message }: { message: MessageWithEvents }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const text = extractText(message.events);

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <div className="flex items-center gap-2 text-[12px] text-text-muted bg-surface-2 rounded-full px-3 py-1">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span className="text-text-secondary">{message.from_role ?? "System"}</span>
          <span>{text}</span>
          <span className="text-text-grey">{formatRelativeTime(message.created_at)}</span>
        </div>
      </div>
    );
  }

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
          <div className={`flex items-center gap-2 mb-1 px-1 ${isUser ? "justify-end" : ""}`}>
            {!isUser && (
              <>
                <span className="text-[12px] font-medium text-text-secondary">{message.from_role ?? "Agent"}</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-shell-600/20 text-shell-400">AI</span>
              </>
            )}
            <span className="text-[11px] text-text-muted">{formatRelativeTime(message.created_at)}</span>
            {isUser && (
              <>
                <span className="text-[12px] font-medium text-text-secondary">{message.from_role ?? "User"}</span>
                <div className="w-7 h-7 rounded-full bg-shell-600 flex items-center justify-center text-[11px] font-medium text-white shrink-0">
                  {(message.from_role ?? "U").charAt(0)}
                </div>
              </>
            )}
          </div>

          <div className={`rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${
            isUser
              ? "rounded-br-md bg-shell-600/20 border border-shell-600/20"
              : "rounded-bl-md bg-surface-2 border border-white/6"
          }`}>
            <div className="text-text-primary whitespace-pre-wrap">{text || <span className="text-text-muted italic">No content</span>}</div>
          </div>

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
