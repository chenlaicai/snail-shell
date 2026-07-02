import React, { useState, useMemo } from "react";
import type { MessageEvent } from "@/types";

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

/** 流式过程折叠区：展示所有事件（包括 text、tool_call、command 等），流式过程和最终答复是两个独立展示区域 */
export function EventStream({ events, expanded, onToggle }: { events: MessageEvent[]; expanded: boolean; onToggle: () => void }) {
  /** 统计各类型事件数量 */
  const { toolCalls, commands } = useMemo(() => {
    return {
      toolCalls: events.filter((e) => e.payload?.type === "tool_call").length,
      commands: events.filter((e) => e.payload?.type === "command").length,
    };
  }, [events]);

  return (
    <div className="mb-2">
      {/* streaming 期间无 events 时不显示摘要行，展开区域留空 */}
      {events.length > 0 && (
        <button
          onClick={onToggle}
          aria-label={expanded ? "Collapse event stream" : "Expand event stream"}
          className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors w-full"
        >
          <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
          <span>
            {events.length} event{events.length > 1 ? "s" : ""}
            {toolCalls > 0 && ` · ${toolCalls} tool call${toolCalls > 1 ? "s" : ""}`}
            {commands > 0 && ` · ${commands} command${commands > 1 ? "s" : ""}`}
          </span>
        </button>
      )}

      {expanded && events.length > 0 && (
        <div className="space-y-1 pl-3 border-l-2 border-white/6 ml-3 mt-1">
          {events.map((event) => (
            <EventItem key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
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
