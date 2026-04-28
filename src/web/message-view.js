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
    case "rich_text": return { kind: "final_text", text: block.text };
    case "markdown": return { kind: "markdown", text: block.text };
    case "image": return { kind: "image", url: block.url, alt: block.alt || "" };
    case "icon": return { kind: "icon", name: block.name, label: block.label || "" };
    case "chart": return { kind: "chart", chartType: block.chart_type, title: block.title || "", data: block.data };
    case "table": return { kind: "table", title: block.title || "", columns: block.columns, rows: block.rows };
    case "tool_call_card": return { kind: "tool_call_card", toolName: block.tool_name, status: block.status || "", summary: block.summary || "", detail: block.detail || "" };
    case "artifact_card": return { kind: "artifact_card", artifactId: block.artifact_id || "", artifactType: block.artifact_type || "", title: block.title, summary: block.summary || "", status: block.status || "" };
    case "reference_card": return { kind: "reference_card", refType: block.ref_type, refId: block.ref_id || "", title: block.title, summary: block.summary || "", href: block.href || "" };
    case "question": return { kind: "question", payload: block };
    case "question_response": return { kind: "final_text", text: block.summary };
    default: return null;
  }
}

function mapEventToContentBlock(event) {
  if (event.kind === "text") return [{ kind: "final_text", text: event.payload?.text || "" }];
  if (event.kind === "content_block") return (event.payload?.blocks || []).map(mapContentBlock).filter(Boolean);
  return [];
}

function mapEventToTraceItem(event) {
  switch (event.kind) {
    case "tool_call": return { kind: "activity", label: describeToolLikeTrace("tool", event.payload?.tool_name, event.payload?.input) };
    case "tool_result": return { kind: event.payload?.is_error ? "error" : "activity", label: event.payload?.error_text || event.payload?.output_text || `[tool-result] ${event.payload?.tool_name || "unknown"}` };
    case "command": return { kind: "activity", label: `[command] ${event.payload?.command || ""}` };
    case "command_result": return { kind: event.payload?.is_error ? "error" : "activity", label: event.payload?.output_text || `[command-result] ${event.payload?.command || ""}` };
    case "signal": return event.payload?.type === "message_completed" ? null : { kind: "activity", label: `[signal] ${event.payload?.type || "signal"}${event.payload?.reason ? `: ${event.payload.reason}` : ""}` };
    case "error": return { kind: "error", label: event.payload?.message || "" };
    default: return null;
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
  const contentBlocks = (record.events || []).flatMap(mapEventToContentBlock).filter(Boolean);
  const traceItems = (record.events || []).map(mapEventToTraceItem).filter(Boolean);
  const errorItems = traceItems.filter((item) => item.kind === "error").map((item) => item.label).filter(Boolean);
  const quotedId = record.quoted_message_id || null;
  const quotedRecord = quotedId ? lookupById.get(quotedId) || null : null;
  const quote = record.quoted_message ? `${messageSpeaker(record.quoted_message)}: ${record.quoted_message.preview || "(空消息)"}` : (quotedRecord ? `${messageSpeaker(quotedRecord)}: ${summarizeRecord(quotedRecord) || "(空消息)"}` : null);

  const blocks = [];
  if (quote) blocks.push({ kind: "quote", text: quote });
  if (record.role === "assistant" && (record.statusView === "thinking" || record.statusView === "pending") && !traceItems.length && !contentBlocks.length) blocks.push({ kind: "placeholder", text: "thinking..." });
  if (traceItems.length) blocks.push({ kind: record.statusView === "streaming" ? "stream_live" : "stream_trace", items: traceItems });
  blocks.push(...contentBlocks);
  if (record.localError && !errorItems.includes(record.localError)) blocks.push({ kind: "error", text: record.localError });
  else if (!contentBlocks.length && errorItems.length) blocks.push({ kind: "error", text: errorItems.join("\n\n") });
  if (!blocks.length && record.role !== "assistant") blocks.push({ kind: "final_text", text: summarizeRecord(record) });

  return { key: record.key, messageId: Number.isInteger(record.id) ? record.id : null, role: record.role === "system" ? "system" : record.role, speaker: messageSpeaker(record), timestamp: formatMessageTimestamp(record.created_at), status: record.statusView, optimistic: record.optimistic, blocks };
}
