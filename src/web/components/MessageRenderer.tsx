/**
 * MessageRenderer - 渲染消息内容块
 *
 * 支持原 message-view.js 中的所有内容类型：
 * - text_event: 纯文本
 * - markdown: Markdown 内容（使用 marked + GFM）
 * - event_activity: 活动事件（工具调用、命令等）
 * - event_error: 错误事件
 * - question: 问题卡片
 * - tool_call_card: 工具调用卡片
 * - image: 图片
 * - table: 表格
 * - permission_request: 权限请求
 * - running_indicator: 运行指示器
 * - quote: 引用
 */

import { MarkdownView } from "./MarkdownRenderer";

/** 类型守卫：检查值是否为可索引的对象 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 验证图片 URL 安全性——仅允许 http(s)、data:image/ 和相对路径 */
function isSafeImageUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("data:image/")) return true;
  if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** 安全访问 event payload 属性——通过 isRecord 守卫避免 as 断言 */
function payloadField(payload: unknown, key: string): unknown {
  if (isRecord(payload) && key in payload) {
    return payload[key];
  }
  return undefined;
}

function payloadString(payload: unknown, key: string, fallback = ""): string {
  const v = payloadField(payload, key);
  return v != null ? String(v) : fallback;
}

function payloadRecord(payload: unknown, key: string): Record<string, unknown> | undefined {
  const v = payloadField(payload, key);
  return isRecord(v) ? v : undefined;
}

// discriminated union — 替代原有的 20+ optional fields interface
type ContentBlock =
  | { kind: "text_event"; text: string }
  | { kind: "markdown"; text: string }
  | { kind: "event_activity"; eventKind: string; summary: string; detail?: string; isError?: boolean }
  | { kind: "event_error"; eventKind: string; summary: string; detail?: string }
  | { kind: "tool_call_card"; toolName: string; status: string; summary: string; detail?: string }
  | { kind: "question"; payload?: Record<string, unknown>; question: string; title?: string }
  | { kind: "permission_request"; tool: string; input?: Record<string, unknown> }
  | { kind: "image"; url: string; alt?: string }
  | { kind: "table"; title?: string; columns: string[]; rows: string[][] }
  | { kind: "chart"; chartType: string; title?: string; data?: unknown }
  | { kind: "icon"; name: string; label?: string }
  | { kind: "artifact_card"; artifactId: string; artifactType: string; title: string; summary?: string; status?: string }
  | { kind: "reference_card"; refType: string; refId: string; title: string; summary?: string; href?: string };

/** 消息内容：分为流式过程和最终答复两部分 */
export interface MessageContent {
  /** 流式过程块（工具调用、活动事件等） */
  processBlocks: ContentBlock[];
  /** 最终答复块（文本、markdown、问题等） */
  finalBlocks: ContentBlock[];
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 是否有待回答的问题 */
  containsQuestion: boolean;
}

/** 从消息事件中提取内容，分为流式过程和最终答复 */
export function extractMessageContent(msg: { events?: Array<Record<string, unknown>>; content?: string; status?: string; context?: { context?: string | null } | null }): MessageContent {
  const fallbackText = msg.content || msg.context?.context || "";
  if (!msg.events || msg.events.length === 0) {
    return {
      processBlocks: [],
      finalBlocks: fallbackText ? [{ kind: "text_event", text: fallbackText }] : [],
      isStreaming: msg.status === "streaming",
      containsQuestion: false,
    };
  }

  const processBlocks: ContentBlock[] = [];
  const finalBlocks: ContentBlock[] = [];
  let containsQuestion = false;

  for (const event of msg.events) {
    const modernPayload = payloadRecord(event, "payload");
    if (modernPayload) {
      const type = payloadString(modernPayload, "type");
      if (type === "text") {
        finalBlocks.push({ kind: "text_event", text: payloadString(modernPayload, "text") });
        continue;
      }
      if (type === "tool_call") {
        processBlocks.push({ kind: "tool_call_card", toolName: payloadString(modernPayload, "tool_name"), status: "running", summary: payloadString(modernPayload, "tool_name"), detail: JSON.stringify(payloadField(modernPayload, "tool_input") || {}) });
        continue;
      }
      if (type === "tool_result") {
        processBlocks.push({ kind: "event_activity", eventKind: "tool_result", summary: `[tool-result] ${payloadString(modernPayload, "tool_name", "tool")}`, detail: payloadString(modernPayload, "result") });
        continue;
      }
      if (type === "signal") {
        const signal = payloadString(modernPayload, "signal");
        if (signal && signal !== "runtime_usage") {
          processBlocks.push({ kind: "event_activity", eventKind: signal, summary: payloadString(modernPayload, "reason") || signal, detail: JSON.stringify(modernPayload) });
        }
        continue;
      }
      if (type === "error") {
        processBlocks.push({ kind: "event_error", eventKind: "error", summary: payloadString(modernPayload, "error"), detail: JSON.stringify(modernPayload) });
        continue;
      }
    }

    const { category, kind, payload } = event;

    if (category === "content" && kind === "text") {
      finalBlocks.push({ kind: "text_event", text: payloadString(payload, "text") });
    } else if (category === "content" && kind === "markdown") {
      finalBlocks.push({ kind: "markdown", text: payloadString(payload, "text") });
    } else if (category === "content_block") {
      const block = mapContentBlock(payload);
      if (block.kind === "text_event" || block.kind === "markdown" || block.kind === "question") {
        if (block.kind === "question") containsQuestion = true;
        finalBlocks.push(block);
      } else {
        processBlocks.push(block);
      }
    } else if (category === "signal") {
      const signalType = payloadString(payload, "type") || kind;
      if (signalType === "runtime_usage") {
        // skip — 已在消息头 badge 展示
      } else if (signalType === "permission_required") {
        finalBlocks.push({ kind: "permission_request", tool: payloadString(payload, "tool"), input: payloadRecord(payload, "input") });
      } else if (!["message_completed", "message_pending_approval", "step_start", "step_finish"].includes(signalType)) {
        processBlocks.push({ kind: "event_activity", eventKind: signalType, summary: payloadString(payload, "detail") || payloadString(payload, "reason") || signalType, detail: JSON.stringify(payload) });
      }
    } else if (category === "tool_call") {
      processBlocks.push({ kind: "tool_call_card", toolName: payloadString(payload, "tool_name"), status: "running", summary: payloadString(payload, "summary") || payloadString(payload, "tool_name"), detail: JSON.stringify(payloadField(payload, "input") || {}) });
    } else if (category === "tool_result") {
      processBlocks.push({ kind: "event_activity", eventKind: "tool_result", summary: `[tool-result] ${payloadString(payload, "tool_name")}`, detail: payloadString(payload, "output_text") || payloadString(payload, "error_text"), isError: Boolean(payloadField(payload, "is_error")) });
    }
  }

  const isStreaming = msg.status === "streaming" || msg.status === "pending" || msg.status === "thinking";
  const visibleFinalBlocks = finalBlocks.filter((b) => b.text || b.summary || b.question);
  if (visibleFinalBlocks.length === 0 && fallbackText) {
    visibleFinalBlocks.push({ kind: "text_event", text: fallbackText });
  }
  return {
    processBlocks: processBlocks.filter((b) => b.text || b.summary || b.toolName || b.question),
    finalBlocks: visibleFinalBlocks,
    isStreaming,
    containsQuestion,
  };
}

function mapContentBlock(payload: unknown): ContentBlock {
  const type = payloadString(payload, "type");
  switch (type) {
    case "text":
    case "rich_text":
      return { kind: "text_event", text: payloadString(payload, "text") };
    case "markdown":
      return { kind: "markdown", text: payloadString(payload, "text") };
    case "question":
      return { kind: "question", payload: payloadRecord(payload, "question") ?? {}, question: payloadString(payload, "question"), title: payloadString(payload, "title") };
    case "question_response":
      return { kind: "text_event", text: payloadString(payload, "summary") };
    case "tool_call_card":
      return { kind: "tool_call_card", toolName: payloadString(payload, "tool_name"), status: payloadString(payload, "status"), summary: payloadString(payload, "summary"), detail: payloadString(payload, "detail") };
    case "artifact_card":
      return { kind: "artifact_card", artifactId: payloadString(payload, "artifact_id"), artifactType: payloadString(payload, "artifact_type"), title: payloadString(payload, "title"), summary: payloadString(payload, "summary"), status: payloadString(payload, "status") };
    case "reference_card":
      return { kind: "reference_card", refType: payloadString(payload, "ref_type"), refId: payloadString(payload, "ref_id"), title: payloadString(payload, "title"), summary: payloadString(payload, "summary"), href: payloadString(payload, "href") };
    case "image":
      return { kind: "image", url: payloadString(payload, "url"), alt: payloadString(payload, "alt") };
    case "table": {
      const cols = payloadField(payload, "columns");
      const rows = payloadField(payload, "rows");
      return { kind: "table", title: payloadString(payload, "title"), columns: Array.isArray(cols) ? cols.map(String) : [], rows: Array.isArray(rows) ? rows.map((r) => Array.isArray(r) ? r.map(String) : []) : [] };
    }
    case "chart":
      return { kind: "chart", chartType: payloadString(payload, "chart_type"), title: payloadString(payload, "title"), data: payloadField(payload, "data") };
    case "icon":
      return { kind: "icon", name: payloadString(payload, "name"), label: payloadString(payload, "label") };
    case "error":
      return { kind: "event_error", eventKind: "error", summary: payloadString(payload, "message") || "error", detail: JSON.stringify(payload) };
    default:
      return { kind: "text_event", text: payloadString(payload, "text") || payloadString(payload, "summary") || JSON.stringify(payload) };
  }
}

/** 渲染流式过程（折叠区域） */
export function EventStreamView({ blocks, defaultOpen, onApprove, onDeny }: {
  blocks: ContentBlock[];
  defaultOpen?: boolean;
  onApprove?: (tool: string, input: Record<string, unknown>) => void;
  onDeny?: (tool: string, input: Record<string, unknown>) => void;
}) {
  if (blocks.length === 0) return null;
  return (
    <details className="border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] bg-[var(--color-bg-elevated)] overflow-hidden" open={defaultOpen}>
      <summary className="flex items-center justify-between gap-[var(--space-md)] p-[var(--space-md)] cursor-pointer list-none text-[var(--color-accent)] text-[var(--font-size-sm)] font-semibold">
        <span className="flex-1 tracking-[0.04em]">流式过程</span>
        <span className="text-[var(--color-text-secondary)] text-[var(--font-size-xs)] font-medium">{blocks.length} 个事件</span>
      </summary>
      <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)] border-t border-[var(--color-border-muted)] bg-[var(--color-bg-deep)]">
        {blocks.map((block, i) => (
          <ContentBlockView key={i} block={block} onApprove={onApprove} onDeny={onDeny} />
        ))}
      </div>
    </details>
  );
}

/** 渲染单个内容块 */
export function ContentBlockView({ block, onApprove, onDeny }: {
  block: ContentBlock;
  onApprove?: (tool: string, input: Record<string, unknown>) => void;
  onDeny?: (tool: string, input: Record<string, unknown>) => void;
}) {
  switch (block.kind) {
    case "text_event":
      return <div className="whitespace-pre-wrap [overflow-wrap:break-word]">{block.text}</div>;

    case "markdown":
      return <MarkdownView text={block.text || ""} />;

    case "event_activity":
      return (
        <details className="border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] mt-[var(--space-sm)] overflow-hidden" open={block.defaultOpen}>
          <summary className={`flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] cursor-pointer text-[var(--font-size-sm)] text-[var(--color-text-secondary)]${block.tone === "error" ? " text-[var(--color-danger-text)]" : ""}`}>
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-link)] uppercase tracking-[0.05em] font-semibold">{block.eventKind}</span>
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{block.summary}</span>
          </summary>
          {block.detail && <pre className="px-[var(--space-md)] py-[var(--space-sm)] font-[var(--font-mono)] text-[var(--font-size-xs)] text-[var(--color-text-muted)] bg-[var(--color-bg-deep)] border-t border-[var(--color-border-muted)] max-h-[300px] overflow-auto whitespace-pre-wrap">{block.detail}</pre>}
        </details>
      );

    case "event_error":
      return (
        <details className="border border-[rgba(248,113,113,0.3)] rounded-[var(--radius-sm)] mt-[var(--space-sm)] overflow-hidden" open={true}>
          <summary className="flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] cursor-pointer text-[var(--font-size-sm)] text-[var(--color-danger-text)]">
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-link)] uppercase tracking-[0.05em] font-semibold">{block.eventKind}</span>
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{block.summary}</span>
          </summary>
          {block.detail && <pre className="px-[var(--space-md)] py-[var(--space-sm)] font-[var(--font-mono)] text-[var(--font-size-xs)] text-[var(--color-text-muted)] bg-[var(--color-bg-deep)] border-t border-[var(--color-border-muted)] max-h-[300px] overflow-auto whitespace-pre-wrap">{block.detail}</pre>}
        </details>
      );

    case "tool_call_card":
      return (
        <div className={`border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] bg-[var(--color-bg-elevated)] mt-[var(--space-sm)] overflow-hidden ${block.status || ""}`}>
          <div className="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)] bg-[rgba(108,141,250,0.06)] border-b border-[var(--color-border-muted)]">
            <span className="font-semibold text-[var(--font-size-sm)] text-[var(--color-accent)]">{block.toolName}</span>
            <span className={`text-[var(--font-size-xs)] px-[6px] py-px rounded-lg ${
              block.status === "completed"
                ? "bg-[rgba(52,211,153,0.15)] text-[var(--color-success-text)]"
                : "bg-[rgba(251,191,36,0.15)] text-[var(--color-warning-text)]"
            }`}>{block.status || "running"}</span>
          </div>
          {block.summary && <div className="px-[var(--space-md)] py-[var(--space-sm)] text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">{block.summary}</div>}
          {block.detail && <pre className="px-[var(--space-md)] py-[var(--space-sm)] font-[var(--font-mono)] text-[var(--font-size-xs)] text-[var(--color-text-muted)] bg-[var(--color-bg-deep)] max-h-[200px] overflow-auto whitespace-pre-wrap border-t border-[var(--color-border-muted)]">{block.detail}</pre>}
        </div>
      );

    case "question":
      return (
        <div className="border border-[var(--color-accent-purple)] border-l-[3px] rounded-[var(--radius-sm)] bg-[var(--color-bg-elevated)] p-[var(--space-md)] mt-[var(--space-sm)]">
          {block.title && <div className="font-semibold text-[var(--font-size-md)] text-[var(--color-accent-purple)] mb-[var(--space-sm)]">{block.title}</div>}
          <div className="text-[var(--font-size-sm)] text-[var(--color-text-primary)] leading-[1.5] mb-[var(--space-md)]">{block.question}</div>
          {block.payload?.options && Array.isArray(block.payload.options) && (
            <div className="flex flex-wrap gap-[var(--space-sm)]">
              {block.payload.options.map((opt: unknown, i: number) => (
                <button key={i} className="px-[var(--space-md)] py-[var(--space-xs)] border border-[var(--color-accent-purple)] rounded-[var(--radius-sm)] bg-transparent text-[var(--color-accent-purple)] cursor-pointer text-[var(--font-size-sm)] hover:bg-[rgba(167,139,250,0.1)]" onClick={() => {/* handle answer */}}>
                  {payloadString(opt, "label")}
                </button>
              ))}
            </div>
          )}
        </div>
      );

    case "permission_request":
      return (
        <div className="bg-[var(--color-assistant-msg-bg)] border border-[var(--color-warning-soft)] rounded-xl p-[var(--space-md)] mt-[var(--space-md)]">
          <div className="text-[var(--font-size-sm)] text-[var(--color-text-primary)] mb-[var(--space-sm)]">工具: {block.tool}</div>
          <div className="flex gap-[var(--space-sm)]">
            <button className="bg-[var(--color-bg-elevated)] text-[var(--color-accent)] border border-[var(--color-accent)] rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-all hover:bg-[rgba(108,141,250,0.08)]" onClick={() => onApprove?.(block.tool || "", block.input || {})}>批准</button>
            <button className="bg-[var(--color-bg-elevated)] text-[var(--color-danger-text)] border border-[var(--color-border-muted)] rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-all hover:border-[var(--color-danger-text)]" onClick={() => onDeny?.(block.tool || "", block.input || {})}>拒绝</button>
          </div>
        </div>
      );

    case "image":
      if (!isSafeImageUrl(block.url)) return null;
      return <img className="max-w-full rounded-[var(--radius-sm)] mt-[var(--space-sm)]" src={block.url} alt={block.alt || ""} />;

    case "table":
      return (
        <div className="border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] overflow-hidden mt-[var(--space-sm)]">
          {block.title && <div className="px-[var(--space-md)] py-[var(--space-sm)] text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] border-b border-[var(--color-border-muted)]">{block.title}</div>}
          <table className="w-full border-collapse">
            {block.columns && (
              <thead>
                <tr>{block.columns.map((col, i) => <th key={i} className="px-[var(--space-md)] py-[var(--space-xs)] border-b border-[var(--color-border-muted)] text-[var(--font-size-sm)] text-left bg-[var(--color-bg-elevated)] font-semibold">{col}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {block.rows?.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} className="px-[var(--space-md)] py-[var(--space-xs)] border-b border-[var(--color-border-muted)] text-[var(--font-size-sm)] text-left">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "artifact_card":
    case "reference_card":
      return (
        <div className={`border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] bg-[var(--color-bg-elevated)] p-[var(--space-md)] mt-[var(--space-sm)] ${block.kind}`}>
          <div className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">{block.title}</div>
          {block.summary && <div className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)] mt-[var(--space-xs)]">{block.summary}</div>}
          {block.href && <a className="inline-block mt-[var(--space-sm)] text-[var(--font-size-xs)] text-[var(--color-accent)] hover:underline" href={block.href} target="_blank" rel="noopener">查看</a>}
        </div>
      );

    case "running_indicator":
      return (
        <div className="flex items-center gap-[var(--space-md)] text-[var(--color-text-blue-muted)] text-[var(--font-size-base)] not-italic">
          <div className="relative shrink-0 basis-[54px] h-5 overflow-hidden border-b border-dotted border-b-[rgba(191,219,254,0.52)]">
            <span className="absolute left-0 -bottom-0.5 inline-block text-[var(--font-size-2xl)] leading-none animate-[snail-crawl_1.8s_ease-in-out_infinite]">🐌</span>
          </div>
          <span>{block.text || "Snail is working"}</span>
        </div>
      );

    case "quote":
      return <blockquote className="border-l-[3px] border-l-[var(--color-accent)] px-[var(--space-md)] py-[var(--space-sm)] my-[var(--space-sm)] bg-[var(--color-bg-elevated)] rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] text-[var(--font-size-sm)]">{block.text}</blockquote>;

    default:
      return block.text ? <div className="whitespace-pre-wrap [overflow-wrap:break-word]">{block.text}</div> : null;
  }
}
