export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

function mapEventToBlocks(event) {
  if (event.kind === "start") return [];
  if (event.kind === "text") return [{ kind: "text_event", text: event.payload?.text || "" }];
  if (event.kind === "content_block") return (event.payload?.blocks || []).map(mapContentBlock).filter(Boolean);
  return [];
}

function mapEventToActivityItem(event) {
  switch (event.kind) {
    case "tool_call": return {
      tone: "activity",
      label: describeToolLikeTrace("tool", event.payload?.tool_name, event.payload?.input),
      detail: stringifyDetail(event.payload?.input),
    };
    case "tool_result": return describeResultActivity({
      label: `[tool-result] ${event.payload?.tool_name || "unknown"}`,
      text: event.payload?.error_text || event.payload?.output_text || "",
      isError: event.payload?.is_error,
    });
    case "command": return { tone: "activity", label: `[command] ${event.payload?.command || ""}`, detail: event.payload?.command || "" };
    case "command_result": return describeResultActivity({
      label: `[command-result] ${event.payload?.command || ""}`,
      text: event.payload?.output_text || "",
      isError: event.payload?.is_error,
    });
    case "signal": return event.payload?.type === "message_completed" ? null : {
      tone: "activity",
      label: `[signal] ${event.payload?.type || "signal"}${event.payload?.reason ? `: ${event.payload.reason}` : ""}`,
      detail: stringifyDetail(event.payload),
    };
    case "error": return { tone: "error", label: event.payload?.message || "", detail: stringifyDetail(event.payload) };
    default: return null;
  }
}

function describeResultActivity(input) {
  const text = String(input.text || "").trim();
  const summary = summarizeResultText(text);
  return {
    tone: input.isError ? "error" : "activity",
    label: summary ? `${input.label}: ${summary}` : input.label,
    detail: text,
  };
}

function summarizeResultText(text) {
  if (!text) return "";
  const line = text.split("\n").map((item) => item.trim()).find(Boolean) || "";
  return truncateText(line.replace(/\s+/g, " "), 140);
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
  return detail ? `[${label}] ${name || "unknown"} ${detail}` : `[${label}] ${name || "unknown"}`;
}

function summarizeToolLikeInput(input) {
  if (!input || typeof input !== "object") return "";
  if (typeof input.command === "string" && input.command.trim()) return `- command: ${input.command.trim()}`;
  if (typeof input.filePath === "string" && input.filePath.trim()) return `- file: ${input.filePath.trim()}`;
  if (typeof input.pattern === "string" && input.pattern.trim()) return `- pattern: ${input.pattern.trim()}`;
  const entries = Object.entries(input).slice(0, 3).map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  return entries.length ? `- ${entries.join(", ")}` : "";
}

export function messageSpeaker(record) {
  if (record?.from_snail) return record.from_snail;
  if (record?.role === "user") return "Boss Snail";
  if (record?.role === "assistant") return "Snail";
  if (record?.role === "system") return "system";
  return record?.role || "";
}

export function summarizeRecord(record) {
  const text = (record.events || []).map((event) => {
    if (event.kind === "text") return event.payload?.text || "";
    if (event.kind === "content_block") return event.payload?.fallback_text || (event.payload?.blocks || []).map(contentTextFromBlock).filter(Boolean).join(" ");
    if (event.kind === "error") return event.payload?.message || "";
    return "";
  }).find((item) => item.trim()) || "";
  return text.replace(/\s+/g, " ").trim();
}

export function buildMessageView(record, lookupById) {
  const eventBlocks = buildOrderedEventBlocks(record.events || []);
  const errorItems = eventBlocks.flatMap((block) => block.kind === "event_log" ? block.items : []).filter((item) => item.tone === "error").map((item) => item.label).filter(Boolean);
  const quotedId = record.quoted_message_id || null;
  const quotedRecord = quotedId ? lookupById.get(quotedId) || null : null;
  const quote = record.quoted_message ? `${messageSpeaker(record.quoted_message)}: ${record.quoted_message.preview || "(空消息)"}` : (quotedRecord ? `${messageSpeaker(quotedRecord)}: ${summarizeRecord(quotedRecord) || "(空消息)"}` : null);

  const blocks = [];
  if (quote) blocks.push({ kind: "quote", text: quote });
  if (record.role === "assistant" && (record.statusView === "thinking" || record.statusView === "pending") && !eventBlocks.length) blocks.push({ kind: "placeholder", text: "thinking..." });
  blocks.push(...eventBlocks);
  if (record.localError && !errorItems.includes(record.localError)) blocks.push({ kind: "error", text: record.localError });
  if (!blocks.length && record.role !== "assistant") blocks.push({ kind: "text_event", text: summarizeRecord(record) });

  return { key: record.key, messageId: Number.isInteger(record.id) ? record.id : null, role: record.role === "system" ? "system" : record.role, speaker: messageSpeaker(record), timestamp: formatMessageTimestamp(record.created_at), status: record.statusView, optimistic: record.optimistic, blocks };
}

function buildOrderedEventBlocks(events) {
  const blocks = [];
  let pendingActivityItems = [];

  function flushActivityItems() {
    if (!pendingActivityItems.length) return;
    blocks.push({ kind: "event_log", items: pendingActivityItems });
    pendingActivityItems = [];
  }

  for (const event of events) {
    const contentBlocks = mapEventToBlocks(event);
    if (contentBlocks.length) {
      flushActivityItems();
      blocks.push(...contentBlocks);
      continue;
    }

    const activityItem = mapEventToActivityItem(event);
    if (activityItem) pendingActivityItems.push(activityItem);
  }

  flushActivityItems();
  return blocks;
}
