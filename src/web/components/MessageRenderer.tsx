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

interface ContentBlock {
  kind: string;
  text?: string;
  payload?: Record<string, unknown>;
  eventKind?: string;
  tone?: string;
  summary?: string;
  detail?: string;
  defaultOpen?: boolean;
  containsQuestion?: boolean;
  // tool_call_card
  toolName?: string;
  status?: string;
  // image
  url?: string;
  alt?: string;
  // table
  title?: string;
  columns?: string[];
  rows?: string[][];
  // question
  question?: string;
  options?: Array<{ label: string; value: string }>;
  // permission_request
  tool?: string;
  input?: Record<string, unknown>;
  // artifact/reference cards
  artifactId?: string;
  artifactType?: string;
  refType?: string;
  refId?: string;
  href?: string;
  // chart
  chartType?: string;
  data?: unknown;
  // icon
  name?: string;
  label?: string;
  // error
  isError?: boolean;
}

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
export function extractMessageContent(msg: { events?: Array<Record<string, unknown>>; content?: string; status?: string }): MessageContent {
  if (msg.content) {
    return { processBlocks: [], finalBlocks: [{ kind: "text_event", text: msg.content }], isStreaming: false, containsQuestion: false };
  }
  if (!msg.events || msg.events.length === 0) {
    return { processBlocks: [], finalBlocks: [], isStreaming: msg.status === "streaming", containsQuestion: false };
  }

  const processBlocks: ContentBlock[] = [];
  const finalBlocks: ContentBlock[] = [];
  let containsQuestion = false;

  for (const event of msg.events) {
    const category = event.category as string;
    const kind = event.kind as string;
    const payload = (event.payload || {}) as Record<string, unknown>;

    if (category === "content" && kind === "text") {
      finalBlocks.push({ kind: "text_event", text: String(payload.text || "") });
    } else if (category === "content" && kind === "markdown") {
      finalBlocks.push({ kind: "markdown", text: String(payload.text || "") });
    } else if (category === "content_block") {
      const block = mapContentBlock(payload);
      if (block.kind === "text_event" || block.kind === "markdown" || block.kind === "question") {
        if (block.kind === "question") containsQuestion = true;
        finalBlocks.push(block);
      } else {
        processBlocks.push(block);
      }
    } else if (category === "signal") {
      const signalType = (payload.type as string) || kind;
      // runtime_usage 只在消息头显示，不进入流式过程
      if (signalType === "runtime_usage") {
        // skip — 已在消息头 badge 展示
      } else if (signalType === "permission_required") {
        finalBlocks.push({ kind: "permission_request", tool: String(payload.tool || ""), input: payload.input as Record<string, unknown> });
      } else if (!["message_completed", "message_pending_approval", "step_start", "step_finish"].includes(signalType)) {
        // start/end/signal 等都进入流式过程
        processBlocks.push({ kind: "event_activity", eventKind: signalType, summary: String(payload.detail || payload.reason || signalType), detail: JSON.stringify(payload) });
      }
    } else if (category === "tool_call") {
      processBlocks.push({ kind: "tool_call_card", toolName: String(payload.tool_name || ""), status: "running", summary: String(payload.summary || payload.tool_name || ""), detail: JSON.stringify(payload.input || {}) });
    } else if (category === "tool_result") {
      processBlocks.push({ kind: "event_activity", eventKind: "tool_result", summary: `[tool-result] ${payload.tool_name || ""}`, detail: String(payload.output_text || payload.error_text || ""), isError: Boolean(payload.is_error) });
    }
  }

  const isStreaming = msg.status === "streaming" || msg.status === "pending" || msg.status === "thinking";
  return {
    processBlocks: processBlocks.filter((b) => b.text || b.summary || b.toolName || b.question),
    finalBlocks: finalBlocks.filter((b) => b.text || b.summary || b.question),
    isStreaming,
    containsQuestion,
  };
}

function mapContentBlock(payload: Record<string, unknown>): ContentBlock {
  const type = payload.type as string;
  switch (type) {
    case "text":
    case "rich_text":
      return { kind: "text_event", text: String(payload.text || "") };
    case "markdown":
      return { kind: "markdown", text: String(payload.text || "") };
    case "question":
      return { kind: "question", payload: payload as Record<string, unknown>, question: String(payload.question || ""), title: String(payload.title || "") };
    case "question_response":
      return { kind: "text_event", text: String(payload.summary || "") };
    case "tool_call_card":
      return { kind: "tool_call_card", toolName: String(payload.tool_name || ""), status: String(payload.status || ""), summary: String(payload.summary || ""), detail: String(payload.detail || "") };
    case "artifact_card":
      return { kind: "artifact_card", artifactId: String(payload.artifact_id || ""), artifactType: String(payload.artifact_type || ""), title: String(payload.title || ""), summary: String(payload.summary || ""), status: String(payload.status || "") };
    case "reference_card":
      return { kind: "reference_card", refType: String(payload.ref_type || ""), refId: String(payload.ref_id || ""), title: String(payload.title || ""), summary: String(payload.summary || ""), href: String(payload.href || "") };
    case "image":
      return { kind: "image", url: String(payload.url || ""), alt: String(payload.alt || "") };
    case "table":
      return { kind: "table", title: String(payload.title || ""), columns: payload.columns as string[], rows: payload.rows as string[][] };
    case "chart":
      return { kind: "chart", chartType: String(payload.chart_type || ""), title: String(payload.title || ""), data: payload.data };
    case "icon":
      return { kind: "icon", name: String(payload.name || ""), label: String(payload.label || "") };
    case "error":
      return { kind: "event_error", eventKind: "error", summary: String(payload.message || "error"), detail: JSON.stringify(payload) };
    default:
      return { kind: "text_event", text: String(payload.text || payload.summary || JSON.stringify(payload)) };
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
    <details className="message-event-stream" open={defaultOpen}>
      <summary>
        <span className="message-event-stream-label">流式过程</span>
        <span className="message-event-stream-hint">{blocks.length} 个事件</span>
      </summary>
      <div className="message-event-stream-body">
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
      return <div className="msg-text">{block.text}</div>;

    case "markdown":
      return <MarkdownView text={block.text || ""} />;

    case "event_activity":
      return (
        <details className="event-activity" open={block.defaultOpen}>
          <summary className={`event-summary ${block.tone || ""}`}>
            <span className="event-kind">{block.eventKind}</span>
            <span className="event-text">{block.summary}</span>
          </summary>
          {block.detail && <pre className="event-detail">{block.detail}</pre>}
        </details>
      );

    case "event_error":
      return (
        <details className="event-error" open={true}>
          <summary className="event-summary error">
            <span className="event-kind">{block.eventKind}</span>
            <span className="event-text">{block.summary}</span>
          </summary>
          {block.detail && <pre className="event-detail">{block.detail}</pre>}
        </details>
      );

    case "tool_call_card":
      return (
        <div className={`tool-call-card ${block.status || ""}`}>
          <div className="tool-call-header">
            <span className="tool-call-name">{block.toolName}</span>
            <span className={`tool-call-status ${block.status || ""}`}>{block.status || "running"}</span>
          </div>
          {block.summary && <div className="tool-call-summary">{block.summary}</div>}
          {block.detail && <pre className="tool-call-detail">{block.detail}</pre>}
        </div>
      );

    case "question":
      return (
        <div className="question-card">
          {block.title && <div className="question-title">{block.title}</div>}
          <div className="question-text">{block.question}</div>
          {block.payload?.options && (
            <div className="question-options">
              {(block.payload.options as Array<{ label: string; value: string }>).map((opt, i) => (
                <button key={i} className="question-option" onClick={() => {/* handle answer */}}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );

    case "permission_request":
      return (
        <div className="permission-request">
          <div className="permission-tool">工具: {block.tool}</div>
          <div className="permission-actions">
            <button className="primary-button" onClick={() => onApprove?.(block.tool || "", block.input || {})}>批准</button>
            <button className="danger-button" onClick={() => onDeny?.(block.tool || "", block.input || {})}>拒绝</button>
          </div>
        </div>
      );

    case "image":
      return <img className="msg-image" src={block.url} alt={block.alt || ""} />;

    case "table":
      return (
        <div className="msg-table">
          {block.title && <div className="table-title">{block.title}</div>}
          <table>
            {block.columns && (
              <thead>
                <tr>{block.columns.map((col, i) => <th key={i}>{col}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {block.rows?.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "artifact_card":
    case "reference_card":
      return (
        <div className={`card-ref ${block.kind}`}>
          <div className="card-ref-title">{block.title}</div>
          {block.summary && <div className="card-ref-summary">{block.summary}</div>}
          {block.href && <a className="card-ref-link" href={block.href} target="_blank" rel="noopener">查看</a>}
        </div>
      );

    case "running_indicator":
      return (
        <div className="running-snail">
          <div className="snail-track">
            <span className="snail-icon">🐌</span>
          </div>
          <span>{block.text || "Snail is working"}</span>
        </div>
      );

    case "quote":
      return <blockquote className="msg-quote">{block.text}</blockquote>;

    default:
      return block.text ? <div className="msg-text">{block.text}</div> : null;
  }
}
