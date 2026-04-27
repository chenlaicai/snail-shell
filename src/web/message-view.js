export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatMessageTimestamp(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  const normalized = text.replace("T", " ").replace(/\.\d+/, "").replace(/Z$/, "");
  return normalized.replace(/([+-]\d{2}:\d{2})$/, "").trim();
}

function getResultPart(record) {
  return record.parts.find((part) => part.kind === "result") || null;
}

function collectDeltaErrors(parts) {
  return parts
    .filter((part) => part.kind === "delta")
    .flatMap((part) => {
      if (part.payload?.kind === "error_observation") return [part.payload.error_text || ""];
      if ((part.payload?.kind === "tool_result" || part.payload?.kind === "mcp_result" || part.payload?.kind === "skill_result") && part.payload?.is_error) {
        return [part.payload.error_text || ""];
      }
      return [];
    })
    .filter(Boolean);
}

function mapResultPayload(payload) {
  if (!payload) return null;
  switch (payload.format) {
    case "blocks":
      return {
        kind: "blocks",
        blocks: payload.blocks || [],
        fallbackText: payload.fallback_text || "",
        payload,
      };
    default:
      return null;
  }
}

function mapContentBlock(block) {
  switch (block.type) {
    case "text":
    case "rich_text":
      return { kind: "final_text", text: block.text };
    case "markdown":
      return { kind: "markdown", text: block.text };
    case "image":
      return { kind: "image", url: block.url, alt: block.alt || "" };
    case "icon":
      return { kind: "icon", name: block.name, label: block.label || "" };
    case "chart":
      return { kind: "chart", chartType: block.chart_type, title: block.title || "", data: block.data };
    case "table":
      return { kind: "table", title: block.title || "", columns: block.columns, rows: block.rows };
    case "tool_call_card":
      return { kind: "tool_call_card", toolName: block.tool_name, status: block.status || "", summary: block.summary || "", detail: block.detail || "" };
    case "artifact_card":
      return { kind: "artifact_card", artifactId: block.artifact_id || "", artifactType: block.artifact_type || "", title: block.title, summary: block.summary || "", status: block.status || "" };
    case "reference_card":
      return { kind: "reference_card", refType: block.ref_type, refId: block.ref_id || "", title: block.title, summary: block.summary || "", href: block.href || "" };
    case "question":
      return { kind: "question", payload: block };
    case "question_response":
      return { kind: "final_text", text: block.summary };
    default:
      return null;
  }
}

function mapDeltaToTraceItem(part) {
  if (part.kind !== "delta") return null;
  switch (part.payload?.kind) {
    case "text":
      return { kind: "text", text: part.payload.text || "" };
    case "tool_call":
      return { kind: "activity", label: describeToolLikeTrace("tool", part.payload.tool_name, part.payload.input) };
    case "tool_result":
      return { kind: part.payload.is_error ? "error" : "activity", label: part.payload.error_text || part.payload.output_text || `[tool-result] ${part.payload.tool_name || "unknown"}` };
    case "mcp_call":
      return { kind: "activity", label: describeToolLikeTrace("mcp", `${part.payload.server_name || "unknown"}/${part.payload.tool_name || "unknown"}`, part.payload.arguments) };
    case "mcp_result":
      return { kind: part.payload.is_error ? "error" : "activity", label: part.payload.error_text || part.payload.output_text || `[mcp-result] ${part.payload.server_name || "unknown"}/${part.payload.tool_name || "unknown"}` };
    case "skill_call":
      return { kind: "activity", label: describeToolLikeTrace("skill", part.payload.skill_name || "unknown", part.payload.input) };
    case "skill_result":
      return { kind: part.payload.is_error ? "error" : "activity", label: part.payload.error_text || part.payload.output_text || `[skill-result] ${part.payload.skill_name || "unknown"}` };
    case "error_observation":
      return { kind: "error", label: part.payload.error_text || "" };
    default:
      return null;
  }
}

function describeToolLikeTrace(label, name, input) {
  const detail = summarizeToolLikeInput(input);
  return detail ? `[${label}] ${name} ${detail}` : `[${label}] ${name}`;
}

function summarizeToolLikeInput(input) {
  if (!input || typeof input !== "object") return "";
  if (typeof input.command === "string" && input.command.trim()) {
    return `- command: ${input.command.trim()}`;
  }
  if (typeof input.filePath === "string" && input.filePath.trim()) {
    const limit = Number.isInteger(input.limit) ? `, limit=${input.limit}` : "";
    const offset = Number.isInteger(input.offset) ? `, offset=${input.offset}` : "";
    return `- file: ${input.filePath.trim()}${offset}${limit}`;
  }
  if (typeof input.pattern === "string" && input.pattern.trim()) {
    const path = typeof input.path === "string" && input.path.trim() ? ` in ${input.path.trim()}` : "";
    return `- pattern: ${input.pattern.trim()}${path}`;
  }
  if (typeof input.file_path === "string" && input.file_path.trim()) {
    return `- file: ${input.file_path.trim()}`;
  }
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
  const resultPart = getResultPart(record);
  const payload = resultPart?.payload;
  let text = "";
  if (payload?.format === "blocks") {
    text = payload.fallback_text || payload.blocks.map((block) => {
      if (block.type === "text" || block.type === "rich_text" || block.type === "markdown") return block.text;
      if (block.type === "question") return block.question || "";
      if (block.type === "question_response") return block.summary || "";
      if (block.type === "artifact_card" || block.type === "reference_card") return block.summary || block.title || "";
      if (block.type === "table") return block.title || "";
      return "";
    }).filter(Boolean).join(" ");
  }
  if (!text) {
    text = collectDeltaErrors(record.parts || []).join(" ");
  }
  return text.replace(/\s+/g, " ").trim();
}

export function buildMessageView(record, lookupById) {
  const result = getResultPart(record);
  const resultBlock = mapResultPayload(result?.payload || null);
  const traceItems = record.parts.map(mapDeltaToTraceItem).filter(Boolean);
  const errorItems = collectDeltaErrors(record.parts);
  const quotedId = record.quoted_message_id || null;
  const quotedRecord = quotedId ? lookupById.get(quotedId) || null : null;
  const quote = record.quoted_message
    ? `${messageSpeaker(record.quoted_message)}: ${record.quoted_message.preview || "(空消息)"}`
    : (quotedRecord ? `${messageSpeaker(quotedRecord)}: ${summarizeRecord(quotedRecord) || "(空消息)"}` : null);

  const blocks = [];
  if (quote) {
    blocks.push({ kind: "quote", text: quote });
  }

  if (record.role === "assistant" && (record.status === "thinking" || record.status === "pending") && !traceItems.length && !resultBlock) {
    blocks.push({ kind: "placeholder", text: "thinking..." });
  }

  if (resultBlock?.kind === "blocks") {
    if (traceItems.length) {
      blocks.push({
        kind: record.status === "streaming" ? "stream_live" : "stream_trace",
        items: traceItems,
      });
    }
    blocks.push(...resultBlock.blocks.map(mapContentBlock).filter(Boolean));
    if (!resultBlock.blocks.length && resultBlock.fallbackText) {
      blocks.push({ kind: "final_text", text: resultBlock.fallbackText });
    }
  } else {
    if (traceItems.length) {
      blocks.push({
        kind: record.status === "streaming" || (!resultBlock && record.status !== "done") ? "stream_live" : "stream_trace",
        items: traceItems,
      });
    }
    if (resultBlock?.kind === "final_text" && resultBlock.text !== null && resultBlock.text !== "") {
      blocks.push({ kind: "final_text", text: resultBlock.text });
    }
  }

  if (record.localError && !errorItems.includes(record.localError)) {
    blocks.push({ kind: "error", text: record.localError });
  } else if (!resultBlock && errorItems.length) {
    blocks.push({ kind: "error", text: errorItems.join("\n\n") });
  }

  if (!blocks.length && record.role !== "assistant") {
    blocks.push({ kind: "final_text", text: summarizeRecord(record) });
  }

  return {
    key: record.key,
    messageId: Number.isInteger(record.id) ? record.id : null,
    role: record.role === "system" ? "system" : record.role,
    speaker: messageSpeaker(record),
    timestamp: formatMessageTimestamp(record.created_at),
    status: record.status,
    optimistic: record.optimistic,
    blocks,
  };
}
