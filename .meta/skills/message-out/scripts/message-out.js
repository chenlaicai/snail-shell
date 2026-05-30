#!/usr/bin/env node
"use strict";

// src/shared/event-content-utils.ts
function extractTextFromBlocks(blocks) {
  return blocks.map(extractTextFromBlock).filter(Boolean).join("\n\n").trim();
}
function extractTextFromBlock(block) {
  const extractor = blockTextExtractors[block.type];
  return extractor ? extractor(block) : "";
}
var blockTextExtractors = {
  text: (block) => block.text,
  rich_text: (block) => block.text,
  markdown: (block) => block.text,
  question: (block) => [block.title, block.question, block.reason ?? ""].filter(Boolean).join("\n"),
  question_response: (block) => block.summary,
  image: (block) => block.alt ?? "",
  icon: (block) => block.label ?? block.name,
  chart: (block) => block.title ?? "",
  table: (block) => [block.title ?? "", block.columns.join(" ")].filter(Boolean).join("\n"),
  tool_call_card: (block) => block.summary ?? block.detail ?? block.tool_name,
  artifact_card: (block) => [block.title, block.summary ?? ""].filter(Boolean).join("\n"),
  reference_card: (block) => [block.title, block.summary ?? ""].filter(Boolean).join("\n")
};

// src/message-bus/message-events.ts
function buildContentBlockEvent(blocks, fallbackText) {
  return {
    kind: "content_block",
    payload: {
      blocks,
      fallback_text: fallbackText ?? (extractTextFromBlocks(blocks) || null)
    }
  };
}

// src/message-bus/message-out.ts
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function normalizeContent(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${fieldName} must be a non-empty string`);
  return value;
}
function normalizeSelectionMode(value) {
  return value === "multiple" ? "multiple" : "single";
}
function normalizeOptionIdentity(option, index, fieldName) {
  const key = typeof option.key === "string" && option.key.trim() ? option.key : null;
  const label = typeof option.label === "string" && option.label.trim() ? option.label : null;
  if (!key || !label) throw new Error(`${fieldName}[${index}] must contain non-empty key and label`);
  return { key, label };
}
function normalizeMentions(value) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) throw new Error("mentions must be an array of role names");
  const mentions = value.map((item) => {
    if (typeof item === "string" && item.trim()) return item;
    if (isRecord(item) && typeof item.role === "string" && item.role.trim()) return item.role;
    throw new Error("mentions must contain role name strings or { role } objects");
  });
  return mentions.length > 0 ? [...new Set(mentions)] : void 0;
}
function normalizeQuestionOptions(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("options must be a non-empty array");
  return value.map((option, index) => {
    if (!isRecord(option)) throw new Error(`options[${index}] must be an object`);
    const { key, label } = normalizeOptionIdentity(option, index, "options");
    return {
      key,
      label,
      description: typeof option.description === "string" ? option.description : null,
      allow_text_input: option.allow_text_input === true,
      text_input_label: typeof option.text_input_label === "string" ? option.text_input_label : null,
      text_input_placeholder: typeof option.text_input_placeholder === "string" ? option.text_input_placeholder : null
    };
  });
}
function normalizeSelectedOptions(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("selected_options must be a non-empty array");
  return value.map((option, index) => {
    if (!isRecord(option)) throw new Error(`selected_options[${index}] must be an object`);
    const { key, label } = normalizeOptionIdentity(option, index, "selected_options");
    return { key, label, extra_text: typeof option.extra_text === "string" ? option.extra_text : null };
  });
}
function normalizeBlocks(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("blocks must be a non-empty array");
  return value.map(normalizeBlock);
}
function normalizeBlock(block, index) {
  if (!isRecord(block) || typeof block.type !== "string") throw new Error(`blocks[${index}] must be an object with a string type`);
  if (block.type === "text") return { type: "text", text: normalizeContent(block.text, `blocks[${index}].text`), mentions: normalizeMentions(block.mentions) ?? [] };
  if (block.type === "rich_text") return { type: "rich_text", text: normalizeContent(block.text, `blocks[${index}].text`) };
  if (block.type === "markdown") return { type: "markdown", text: normalizeContent(block.text, `blocks[${index}].text`), mentions: normalizeMentions(block.mentions) ?? [] };
  if (block.type === "image") return { type: "image", url: normalizeContent(block.url, `blocks[${index}].url`), alt: typeof block.alt === "string" ? block.alt : null };
  if (block.type === "icon") return { type: "icon", name: normalizeContent(block.name, `blocks[${index}].name`), label: typeof block.label === "string" ? block.label : null };
  if (block.type === "chart") return normalizeChartBlock(block, index);
  if (block.type === "table") return normalizeTableBlock(block, index);
  if (block.type === "tool_call_card") return normalizeToolCallCardBlock(block, index);
  if (block.type === "artifact_card") return normalizeArtifactCardBlock(block, index);
  if (block.type === "reference_card") return normalizeReferenceCardBlock(block, index);
  if (block.type === "question") return {
    type: "question",
    title: normalizeContent(block.title, `blocks[${index}].title`),
    question: normalizeContent(block.question, `blocks[${index}].question`),
    reason: typeof block.reason === "string" && block.reason.trim() ? block.reason : null,
    selection_mode: normalizeSelectionMode(block.selection_mode),
    options: normalizeQuestionOptions(block.options)
  };
  if (block.type === "question_response") {
    const responseTo = isRecord(block.response_to) ? block.response_to : null;
    const title = responseTo && typeof responseTo.title === "string" && responseTo.title.trim() ? responseTo.title : null;
    if (!title) throw new Error(`blocks[${index}].response_to.title must be a non-empty string`);
    return {
      type: "question_response",
      response_to: { title },
      selection_mode: normalizeSelectionMode(block.selection_mode),
      selected_options: normalizeSelectedOptions(block.selected_options),
      summary: normalizeContent(block.summary, `blocks[${index}].summary`)
    };
  }
  throw new Error(`blocks[${index}] has unsupported type: ${block.type}`);
}
function normalizeTableBlock(block, index) {
  if (!Array.isArray(block.columns) || block.columns.some((column) => typeof column !== "string")) throw new Error(`blocks[${index}].columns must be an array of strings`);
  if (!Array.isArray(block.rows) || block.rows.some((row) => !Array.isArray(row))) throw new Error(`blocks[${index}].rows must be a 2D array`);
  return { type: "table", columns: block.columns, rows: block.rows, title: typeof block.title === "string" ? block.title : null };
}
function normalizeChartBlock(block, index) {
  if (!isRecord(block.data)) throw new Error(`blocks[${index}].data must be an object`);
  return { type: "chart", chart_type: block.chart_type === "line" || block.chart_type === "pie" || block.chart_type === "table" ? block.chart_type : "bar", title: typeof block.title === "string" ? block.title : null, data: block.data };
}
function normalizeToolCallCardBlock(block, index) {
  return { type: "tool_call_card", tool_name: normalizeContent(block.tool_name, `blocks[${index}].tool_name`), status: normalizeToolCardStatus(block.status) ?? null, summary: typeof block.summary === "string" ? block.summary : null, detail: typeof block.detail === "string" ? block.detail : null };
}
function normalizeArtifactCardBlock(block, index) {
  return { type: "artifact_card", artifact_id: typeof block.artifact_id === "string" ? block.artifact_id : null, artifact_type: typeof block.artifact_type === "string" ? block.artifact_type : null, title: normalizeContent(block.title, `blocks[${index}].title`), summary: typeof block.summary === "string" ? block.summary : null, status: typeof block.status === "string" ? block.status : null };
}
function normalizeReferenceCardBlock(block, index) {
  return { type: "reference_card", ref_type: block.ref_type === "artifact" || block.ref_type === "conversation" || block.ref_type === "stage" || block.ref_type === "workspace" || block.ref_type === "external" ? block.ref_type : "message", ref_id: typeof block.ref_id === "string" ? block.ref_id : null, title: normalizeContent(block.title, `blocks[${index}].title`), summary: typeof block.summary === "string" ? block.summary : null, href: typeof block.href === "string" ? block.href : null };
}
function normalizeToolCardStatus(value) {
  return value === "pending" || value === "running" || value === "success" || value === "error" ? value : void 0;
}
function buildMessageOutBlocks(input) {
  return buildContentBlockEvent(normalizeBlocks(input.blocks), typeof input.fallback_text === "string" && input.fallback_text.trim() ? input.fallback_text : null);
}
function parseMessageOutPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`message-out payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!isRecord(parsed)) throw new Error("message-out payload must be a JSON object");
  if (typeof parsed.format !== "string") throw new Error("message-out payload must contain a string format field");
  if (parsed.format !== "blocks") throw new Error("message-out payload format must be blocks");
  return buildMessageOutBlocks(parsed);
}
function stringifyMessageOutPart(event) {
  if (event.kind !== "content_block") throw new Error(`message-out stringify only supports content_block events, got ${event.kind}`);
  return `${JSON.stringify({ format: "blocks", ...event.payload }, null, 2)}
`;
}

// src/bin/message-out.ts
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
function parseNamedArgs(argv) {
  const [command, ...rest] = argv;
  const namedArgs = {};
  const positionalArgs = [];
  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const values = [];
      i++;
      while (i < rest.length && !rest[i].startsWith("--")) {
        values.push(rest[i]);
        i++;
      }
      namedArgs[key] = values;
    } else {
      positionalArgs.push(arg);
      i++;
    }
  }
  return { command: command ?? "", namedArgs, positionalArgs };
}
function getSingleArg(namedArgs, key) {
  const values = namedArgs[key];
  if (!values || values.length === 0) return void 0;
  return values[0];
}
function getMultipleArgs(namedArgs, key) {
  const values = namedArgs[key];
  if (!values || values.length === 0) return void 0;
  return values;
}
function requireArg(namedArgs, key, command) {
  const value = getSingleArg(namedArgs, key);
  if (value === void 0) throw new Error(`${command} command requires --${key} parameter`);
  return value;
}
function buildTextPayload(text, mentions) {
  return JSON.stringify({
    format: "blocks",
    blocks: [{ type: "text", text, ...mentions ? { mentions } : {} }],
    fallback_text: text
  });
}
function buildQuestionPayload(title, question, options, reason) {
  return JSON.stringify({
    format: "blocks",
    blocks: [{
      type: "question",
      title,
      question,
      reason: reason ?? null,
      selection_mode: "single",
      options
    }],
    fallback_text: `${title}
${question}`.trim()
  });
}
function buildQuestionResponsePayload(title, selectedOptions, summary, selectionMode) {
  return JSON.stringify({
    format: "blocks",
    blocks: [{
      type: "question_response",
      response_to: { title },
      selection_mode: selectionMode === "multiple" ? "multiple" : "single",
      selected_options: selectedOptions,
      summary
    }],
    fallback_text: summary
  });
}
function buildMarkdownPayload(text) {
  return JSON.stringify({
    format: "blocks",
    blocks: [{ type: "markdown", text }],
    fallback_text: text
  });
}
function buildTablePayload(title, columns, rows) {
  return JSON.stringify({
    format: "blocks",
    blocks: [{ type: "table", title: title ?? null, columns, rows }],
    fallback_text: title ?? "table"
  });
}
function buildArtifactCardPayload(title, summary, artifactId, artifactType) {
  return JSON.stringify({
    format: "blocks",
    blocks: [{
      type: "artifact_card",
      title,
      summary: summary ?? null,
      artifact_id: artifactId ?? null,
      artifact_type: artifactType ?? null
    }],
    fallback_text: summary ?? title
  });
}
function buildReferenceCardPayload(title, refType, refId, summary) {
  return JSON.stringify({
    format: "blocks",
    blocks: [{
      type: "reference_card",
      title,
      ref_type: refType,
      ref_id: refId,
      summary: summary ?? null
    }],
    fallback_text: summary ?? title
  });
}
function parseJsonArray(value, fieldName) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error(`${fieldName} must be a JSON array`);
    return parsed;
  } catch (error) {
    throw new Error(`Invalid JSON for ${fieldName}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
function printUsage() {
  process.stderr.write([
    "Usage:",
    "",
    "  # \u6587\u672C\u56DE\u590D\uFF08\u4ECE stdin \u8BFB\u53D6\uFF09",
    "  echo 'hello' | node .meta/skills/message-out/scripts/message-out.js text",
    "",
    "  # \u5E26 mention \u7684\u6587\u672C\u56DE\u590D",
    "  node .meta/skills/message-out/scripts/message-out.js text --text '\u5DF2\u63D0\u4EA4\u68C0\u89C6\u610F\u89C1' --mentions '\u7814\u53D1\u8005' '\u68C0\u89C6\u8005'",
    "",
    "  # \u7528\u6237\u95EE\u9898\u5361\u7247",
    `  node .meta/skills/message-out/scripts/message-out.js question --title '\u9700\u8981\u786E\u8BA4' --question '\u8BF7\u9009\u62E9\u65B9\u6848' --options '[{"key":"a","label":"\u65B9\u6848A"}]'`,
    "",
    "  # \u95EE\u9898\u56DE\u7B54",
    `  node .meta/skills/message-out/scripts/message-out.js question-response --title '\u9700\u8981\u786E\u8BA4' --options '[{"key":"a","label":"\u65B9\u6848A"}]' --summary '\u9009\u62E9\u4E86\u65B9\u6848A'`,
    "",
    "  # Markdown \u5757",
    "  echo '# \u6807\u9898' | node .meta/skills/message-out/scripts/message-out.js markdown",
    "",
    "  # \u8868\u683C",
    `  node .meta/skills/message-out/scripts/message-out.js table --columns '["\u52171","\u52172"]' --rows '[["\u503C1","\u503C2"]]'`,
    "",
    "  # Artifact \u5F15\u7528\u5361\u7247",
    "  node .meta/skills/message-out/scripts/message-out.js artifact-card --title '\u6587\u6863\u6807\u9898' --summary '\u6458\u8981'",
    "",
    "  # Reference \u5F15\u7528\u5361\u7247",
    "  node .meta/skills/message-out/scripts/message-out.js reference-card --title '\u53C2\u8003' --ref-type message --ref-id 123",
    "",
    "  # \u901A\u7528 blocks\uFF08\u4ECE stdin \u8BFB\u53D6 JSON\uFF09",
    `  echo '{"format":"blocks","blocks":[...]}' | node .meta/skills/message-out/scripts/message-out.js blocks`
  ].join("\n") + "\n");
}
async function buildTextCommandPayload(namedArgs) {
  const text = getSingleArg(namedArgs, "text") ?? await readStdin();
  const mentions = getMultipleArgs(namedArgs, "mentions");
  return buildTextPayload(text, mentions);
}
function buildQuestionCommandPayload(command, namedArgs) {
  const title = requireArg(namedArgs, "title", command);
  const question = requireArg(namedArgs, "question", command);
  const optionsJson = requireArg(namedArgs, "options", command);
  const reason = getSingleArg(namedArgs, "reason");
  const options = parseJsonArray(optionsJson, "options");
  return buildQuestionPayload(title, question, options, reason);
}
function buildQuestionResponseCommandPayload(command, namedArgs) {
  const title = requireArg(namedArgs, "title", command);
  const optionsJson = requireArg(namedArgs, "options", command);
  const summary = requireArg(namedArgs, "summary", command);
  const selectionMode = getSingleArg(namedArgs, "selection-mode") ?? "single";
  const options = parseJsonArray(optionsJson, "options");
  return buildQuestionResponsePayload(title, options, summary, selectionMode);
}
async function buildMarkdownCommandPayload(namedArgs) {
  const text = getSingleArg(namedArgs, "text") ?? await readStdin();
  return buildMarkdownPayload(text);
}
function buildTableCommandPayload(command, namedArgs) {
  const columnsJson = requireArg(namedArgs, "columns", command);
  const rowsJson = requireArg(namedArgs, "rows", command);
  const title = getSingleArg(namedArgs, "title");
  const columns = parseJsonArray(columnsJson, "columns");
  const rows = parseJsonArray(rowsJson, "rows");
  return buildTablePayload(title, columns, rows);
}
function buildArtifactCardCommandPayload(command, namedArgs) {
  const title = requireArg(namedArgs, "title", command);
  const summary = getSingleArg(namedArgs, "summary");
  const artifactId = getSingleArg(namedArgs, "artifact-id");
  const artifactType = getSingleArg(namedArgs, "artifact-type");
  return buildArtifactCardPayload(title, summary, artifactId, artifactType);
}
function buildReferenceCardCommandPayload(command, namedArgs) {
  const title = requireArg(namedArgs, "title", command);
  const refType = requireArg(namedArgs, "ref-type", command);
  const refId = requireArg(namedArgs, "ref-id", command);
  const summary = getSingleArg(namedArgs, "summary");
  return buildReferenceCardPayload(title, refType, refId, summary);
}
async function buildPayloadForCommand(command, namedArgs) {
  if (command === "text") return buildTextCommandPayload(namedArgs);
  if (command === "question") return buildQuestionCommandPayload(command, namedArgs);
  if (command === "question-response") return buildQuestionResponseCommandPayload(command, namedArgs);
  if (command === "markdown") return buildMarkdownCommandPayload(namedArgs);
  if (command === "table") return buildTableCommandPayload(command, namedArgs);
  if (command === "artifact-card") return buildArtifactCardCommandPayload(command, namedArgs);
  if (command === "reference-card") return buildReferenceCardCommandPayload(command, namedArgs);
  return readStdin();
}
async function main() {
  const { command, namedArgs } = parseNamedArgs(process.argv.slice(2));
  if (!command || !["text", "question", "question-response", "markdown", "table", "artifact-card", "reference-card", "blocks"].includes(command)) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const payload = await buildPayloadForCommand(command, namedArgs);
  const event = parseMessageOutPayload(payload);
  if (event.kind !== "content_block") throw new Error(`${command} command must produce a content_block event`);
  process.stdout.write(stringifyMessageOutPart(event));
}
main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
});
