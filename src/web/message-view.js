export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const EVENT_SUMMARY_MAX_LENGTH = 96;

export function formatMessageTimestamp(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  const normalized = text.replace("T", " ").replace(/\.\d+/, "").replace(/Z$/, "");
  return normalized.replace(/([+-]\d{2}:\d{2})$/, "").trim();
}

function contentTextFromBlock(block) {
  if (!block) return "";
  if (block.type === "text" || block.type === "rich_text" || block.type === "markdown") return block.text || "";
  if (block.type === "question") return [block.title, block.question].filter(Boolean).join("\n");
  if (block.type === "question_response") return block.summary || "";
  if (block.type === "artifact_card" || block.type === "reference_card") return [block.title, block.summary].filter(Boolean).join("\n");
  if (block.type === "table") return [block.title, Array.isArray(block.columns) ? block.columns.join(" ") : ""].filter(Boolean).join("\n");
  if (block.type === "tool_call_card") return block.summary || block.detail || block.tool_name || "";
  return block.alt || block.label || block.name || "";
}

const TEXT_CONTENT_BLOCK_TYPES = new Set(["markdown", "text", "rich_text", "question_response"]);

function mapContentBlock(block) {
  switch (block.type) {
    case "text":
    case "rich_text": return { kind: "text_event", text: block.text };
    case "markdown": return { kind: "markdown", text: block.text };
    case "image": return { kind: "image", url: block.url, alt: block.alt || "" };
    case "icon": return { kind: "icon", name: block.name, label: block.label || "" };
    case "chart": return { kind: "chart", chartType: block.chart_type, title: block.title || "", data: block.data };
    case "table": return { kind: "table", title: block.title || "", columns: block.columns, rows: block.rows };
    case "tool_call_card": return { kind: "tool_call_card", toolName: block.tool_name, status: block.status || "", summary: block.summary || "", detail: block.detail || "" };
    case "artifact_card": return { kind: "artifact_card", artifactId: block.artifact_id || "", artifactType: block.artifact_type || "", title: block.title, summary: block.summary || "", status: block.status || "" };
    case "reference_card": return { kind: "reference_card", refType: block.ref_type, refId: block.ref_id || "", title: block.title, summary: block.summary || "", href: block.href || "" };
    case "question": return { kind: "question", payload: block };
    case "question_response": return { kind: "text_event", text: block.summary };
    default: return null;
  }
}

function mapEventToBlock(event) {
  if (event.kind === "start") return null;
  switch (event.kind) {
    case "text": return buildTextEventBlock(event);
    case "content_block": return buildContentBlockEventBlock(event);
    case "tool_call": return buildToolCallEventBlock(event);
    case "tool_result": return describeResultActivity({
      eventKind: "tool_result",
      summary: `[tool-result] ${event.payload?.tool_name || "unknown"}`,
      text: event.payload?.error_text || event.payload?.output_text || "",
      isError: event.payload?.is_error,
    });
    case "command": return { kind: "event_activity", eventKind: "command", tone: "activity", summary: `[command] ${event.payload?.command || ""}`, detail: event.payload?.command || "", defaultOpen: false };
    case "command_result": return describeResultActivity({
      eventKind: "command_result",
      summary: `[command-result] ${event.payload?.command || ""}`,
      text: event.payload?.output_text || "",
      isError: event.payload?.is_error,
    });
    case "signal": return shouldHideSignalEvent(event.payload?.type) ? null : {
      kind: "event_activity",
      eventKind: "signal",
      tone: "activity",
      summary: `[signal] ${event.payload?.type || "signal"}${event.payload?.reason ? `: ${event.payload.reason}` : ""}`,
      detail: stringifyDetail(event.payload),
      defaultOpen: false,
    };
    case "error": return { kind: "event_error", eventKind: "error", tone: "error", summary: event.payload?.message || "error", detail: stringifyDetail(event.payload), defaultOpen: false };
    default: return null;
  }
}

function contextKindLabel(kind) {
  switch (kind) {
    case "final_text": return "最终文本";
    case "message_out": return "Message Out";
    case "event_summary": return "过程摘要";
    case "llm_summary": return "LLM 摘要";
    default: return kind || "上下文";
  }
}

function buildContextBlock(record) {
  const text = record.context?.context || "";
  if (!text.trim()) return null;
  return {
    kind: "message_context",
    contextKind: record.context.kind,
    summary: contextKindLabel(record.context.kind),
    text,
  };
}

function buildEventStreamBlock(eventBlocks) {
  if (!eventBlocks.length) return null;
  const containsQuestion = eventBlocks.some((block) => block.containsQuestion);
  return {
    kind: "event_stream",
    summary: "流式过程",
    count: eventBlocks.length,
    blocks: eventBlocks,
    /**
     * question 是需要用户立即处理的交互表单。完成态 assistant 消息可以折叠普通
     * final_text 之前的流式过程，但不能把待回答问题默认藏进折叠区，否则用户看不到
     * 表单，顶层消息样式也无法提示当前消息需要决策。
     */
    defaultOpen: containsQuestion,
    containsQuestion,
  };
}

function shouldHideSignalEvent(type) {
  return ["message_completed", "step_start", "step_finish"].includes(type || "");
}

function buildTextEventBlock(event) {
  const text = event.payload?.text || "";
  const contentBlock = parseStructuredTextAsContentBlock(text);
  if (contentBlock) return contentBlock;
  return {
    kind: "event_text",
    eventKind: "text",
    summary: summarizeResultText(text) || "text",
    bodyBlocks: [{ kind: "text_event", text }],
    defaultOpen: true,
  };
}

function parseStructuredTextAsContentBlock(text) {
  const payload = parseMessageOutPayloadForView(text);
  if (!payload) return null;
  const event = {
    kind: "content_block",
    payload: {
      fallback_text: payload.fallback_text || payload.blocks.map(contentTextFromBlock).filter(Boolean).join("\n"),
      blocks: payload.blocks,
    },
  };
  return { ...buildContentBlockEventBlock(event), eventKind: "text", sourceFormat: "message_out" };
}

function parseMessageOutPayloadForView(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || value.format !== "blocks" || !Array.isArray(value.blocks)) return null;
    const blocks = value.blocks.map(normalizeViewBlock).filter(Boolean);
    if (!blocks.length) return null;
    return { fallback_text: typeof value.fallback_text === "string" ? value.fallback_text : "", blocks };
  } catch {
    return null;
  }
}

function normalizeViewBlock(block) {
  if (!block || typeof block !== "object") return null;
  if (["text", "rich_text", "markdown"].includes(block.type)) return typeof block.text === "string" ? { ...block, text: block.text } : null;
  if (block.type === "question") return block;
  if (block.type === "question_response") return block;
  if (block.type === "table") return Array.isArray(block.columns) && Array.isArray(block.rows) ? block : null;
  if (block.type === "tool_call_card") return typeof block.tool_name === "string" ? block : null;
  if (block.type === "artifact_card") return typeof block.title === "string" ? block : null;
  if (block.type === "reference_card") return typeof block.title === "string" ? block : null;
  return null;
}

function buildContentBlockEventBlock(event) {
  const sourceBlocks = Array.isArray(event.payload?.blocks) ? event.payload.blocks : [];
  const bodyBlocks = sourceBlocks.map(mapContentBlock).filter(Boolean);
  const summary = event.payload?.fallback_text || sourceBlocks.map(contentTextFromBlock).filter(Boolean).join(" ") || "content_block";
  const containsQuestion = sourceBlocks.some((block) => block?.type === "question");
  return {
    kind: "event_content_block",
    eventKind: "content_block",
    summary: summarizeResultText(summary) || "content_block",
    bodyBlocks,
    detail: bodyBlocks.length ? "" : stringifyDetail(event.payload),
    defaultOpen: containsQuestion || isTextOrientedContentBlock(sourceBlocks),
    containsQuestion,
  };
}

function buildToolCallEventBlock(event) {
  return {
    kind: "event_activity",
    eventKind: "tool_call",
    tone: "activity",
    summary: describeToolLikeTrace("tool", event.payload?.tool_name, event.payload?.input),
    detail: stringifyDetail(event.payload?.input),
    defaultOpen: false,
  };
}

function isTextOrientedContentBlock(blocks) {
  if (!blocks.length) return false;
  let textCount = 0;
  let otherCount = 0;
  for (const block of blocks) {
    if (TEXT_CONTENT_BLOCK_TYPES.has(block?.type)) textCount += 1;
    else otherCount += 1;
  }
  return textCount > otherCount;
}

function describeResultActivity(input) {
  const text = String(input.text || "").trim();
  const summary = summarizeResultText(text);
  return {
    kind: input.isError ? "event_error" : "event_activity",
    eventKind: input.eventKind,
    tone: input.isError ? "error" : "activity",
    summary: summary ? `${input.summary}: ${summary}` : input.summary,
    detail: text,
    defaultOpen: false,
  };
}

function summarizeResultText(text) {
  if (!text) return "";
  const line = text.split("\n").map((item) => item.trim()).find(Boolean) || "";
  return truncateText(line.replace(/\s+/g, " "), EVENT_SUMMARY_MAX_LENGTH);
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function stringifyDetail(value) {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function describeToolLikeTrace(label, name, input) {
  const detail = summarizeToolLikeInput(input);
  return truncateText(detail ? `[${label}] ${name || "unknown"} ${detail}` : `[${label}] ${name || "unknown"}`, EVENT_SUMMARY_MAX_LENGTH);
}

function summarizeToolLikeInput(input) {
  if (!input || typeof input !== "object") return "";
  if (typeof input.command === "string" && input.command.trim()) return `- command: ${truncateText(input.command.trim().replace(/\s+/g, " "), 64)}`;
  if (typeof input.filePath === "string" && input.filePath.trim()) return `- file: ${truncateText(input.filePath.trim(), 64)}`;
  if (typeof input.pattern === "string" && input.pattern.trim()) return `- pattern: ${truncateText(input.pattern.trim().replace(/\s+/g, " "), 64)}`;
  const entries = Object.entries(input).slice(0, 3).map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  return entries.length ? `- ${truncateText(entries.join(", ").replace(/\s+/g, " "), 64)}` : "";
}

export function messageSpeaker(record) {
  if (record?.from_snail) return record.from_snail;
  if (record?.role === "user") return "Boss Snail";
  if (record?.role === "assistant") return "Snail";
  if (record?.role === "system") return "system";
  return record?.role || "";
}

export function summarizeRecord(record) {
  if (record.context?.context) return record.context.context.replace(/\s+/g, " ").trim();
  const text = (record.events || []).map((event) => {
    if (event.kind === "text") return event.payload?.text || "";
    if (event.kind === "content_block") return event.payload?.fallback_text || (event.payload?.blocks || []).map(contentTextFromBlock).filter(Boolean).join(" ");
    if (event.kind === "error") return event.payload?.message || "";
    return "";
  }).find((item) => item.trim()) || "";
  return text.replace(/\s+/g, " ").trim();
}

export function buildMessageView(record, lookupById, options = {}) {
  const displayEvents = normalizeEventsForView(record.events || []);
  const eventBlocks = displayEvents.map(mapEventToBlock).filter(Boolean);
  const errorItems = eventBlocks.filter((block) => block.tone === "error").map((block) => block.summary).filter(Boolean);
  const quotedId = record.quoted_message_id || null;
  const quotedRecord = quotedId ? lookupById.get(quotedId) || null : null;
  const quote = record.quoted_message ? `${messageSpeaker(record.quoted_message)}: ${record.quoted_message.preview || "(空消息)"}` : (quotedRecord ? `${messageSpeaker(quotedRecord)}: ${summarizeRecord(quotedRecord) || "(空消息)"}` : null);
  const isAssistantRunning = record.role === "assistant" && ["pending", "thinking", "streaming", "idle"].includes(record.statusView);

  const blocks = [];
  if (quote) blocks.push({ kind: "quote", text: quote });
  if (isAssistantRunning) blocks.push({ kind: "running_indicator", text: eventBlocks.length ? "Snail is still working" : "Snail is starting" });
  const contextBlock = buildContextBlock(record);
  const shouldFoldCompletedStream = record.role === "assistant" && !isAssistantRunning && ["final_text", "message_out"].includes(contextBlock?.contextKind);
  if (shouldFoldCompletedStream) {
    const streamBlock = buildEventStreamBlock(eventBlocks);
    if (streamBlock) blocks.push(streamBlock);
    blocks.push(contextBlock);
  } else {
    if (contextBlock) blocks.push(contextBlock);
    /**
     * 非 assistant 消息也可能只有 text/content_block 事件而没有最终上下文。
     * 引用块会先占用 blocks，不能再依赖空消息 fallback 补正文；但已有上下文时仍以
     * 上下文作为规范正文，避免 Boss/user 消息重复显示事件轨迹。
     */
    if (record.role === "assistant" || !contextBlock) blocks.push(...eventBlocks);
  }
  if (record.localError && !errorItems.includes(record.localError)) blocks.push({ kind: "error", text: record.localError });
  if (!blocks.length && record.role !== "assistant") blocks.push({ kind: "text_event", text: summarizeRecord(record) });

  const messageId = Number.isInteger(record.id) ? record.id : null;
  const interruptible = Boolean(options.canInterruptMessage?.(record, { isAssistantRunning }));
  const interruptPending = interruptible && Boolean(options.isInterruptPending?.(messageId));
  return { key: record.key, messageId, role: record.role === "system" ? "system" : record.role, speaker: messageSpeaker(record), timestamp: formatMessageTimestamp(record.created_at), status: record.statusView, optimistic: record.optimistic, interruptible, interruptPending, blocks };
}

function normalizeEventsForView(events) {
  const textEvents = events.filter((event) => event.kind === "text");
  if (textEvents.length <= 1) return events;
  const combinedText = textEvents.map((event) => event.payload?.text || "").join("");
  if (!parseMessageOutPayloadForView(combinedText)) return events;
  let inserted = false;
  return events.flatMap((event) => {
    if (event.kind !== "text") return [event];
    if (inserted) return [];
    inserted = true;
    return [{ ...event, payload: { ...(event.payload || {}), text: combinedText } }];
  });
}
