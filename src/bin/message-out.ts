import { parseMessageOutPayload, stringifyMessageOutPart } from "../project/message-out";

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

interface ParsedArgs {
  command: string;
  namedArgs: Record<string, string[]>;
  positionalArgs: string[];
}

function parseNamedArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const namedArgs: Record<string, string[]> = {};
  const positionalArgs: string[] = [];

  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const values: string[] = [];
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

function getSingleArg(namedArgs: Record<string, string[]>, key: string): string | undefined {
  const values = namedArgs[key];
  if (!values || values.length === 0) return undefined;
  return values[0];
}

/**
 * 获取多值参数。用于支持 --mentions 等需要传入多个值的场景。
 * 例如：--mentions 'Implementation Snail' 'Acceptance Snail' 会解析为两个独立的值。
 * 这种设计比要求用户传入 JSON 数组更友好，且与命令行惯例一致。
 */
function getMultipleArgs(namedArgs: Record<string, string[]>, key: string): string[] | undefined {
  const values = namedArgs[key];
  if (!values || values.length === 0) return undefined;
  return values;
}

function requireArg(namedArgs: Record<string, string[]>, key: string, command: string): string {
  const value = getSingleArg(namedArgs, key);
  if (value === undefined) throw new Error(`${command} command requires --${key} parameter`);
  return value;
}

function buildTextPayload(text: string, mentions?: string[]): string {
  return JSON.stringify({
    format: "blocks",
    blocks: [{ type: "text", text, ...(mentions ? { mentions } : {}) }],
    fallback_text: text,
  });
}

function buildQuestionPayload(title: string, question: string, options: unknown[], reason?: string): string {
  return JSON.stringify({
    format: "blocks",
    blocks: [{
      type: "question",
      title,
      question,
      reason: reason ?? null,
      selection_mode: "single",
      options,
    }],
    fallback_text: `${title}\n${question}`.trim(),
  });
}

/**
 * 构建问题回答 payload。
 * selectionMode 默认为 "single"，因为大多数用户交互场景是单选。
 * 只有显式指定 --selection-mode multiple 时才为多选，这与用户预期一致。
 */
function buildQuestionResponsePayload(title: string, selectedOptions: unknown[], summary: string, selectionMode: string): string {
  return JSON.stringify({
    format: "blocks",
    blocks: [{
      type: "question_response",
      response_to: { title },
      selection_mode: selectionMode === "multiple" ? "multiple" : "single",
      selected_options: selectedOptions,
      summary,
    }],
    fallback_text: summary,
  });
}

function buildMarkdownPayload(text: string): string {
  return JSON.stringify({
    format: "blocks",
    blocks: [{ type: "markdown", text }],
    fallback_text: text,
  });
}

function buildTablePayload(title: string | undefined, columns: string[], rows: unknown[][]): string {
  return JSON.stringify({
    format: "blocks",
    blocks: [{ type: "table", title: title ?? null, columns, rows }],
    fallback_text: title ?? "table",
  });
}

function buildArtifactCardPayload(title: string, summary?: string, artifactId?: string, artifactType?: string): string {
  return JSON.stringify({
    format: "blocks",
    blocks: [{
      type: "artifact_card",
      title,
      summary: summary ?? null,
      artifact_id: artifactId ?? null,
      artifact_type: artifactType ?? null,
    }],
    fallback_text: summary ?? title,
  });
}

function buildReferenceCardPayload(title: string, refType: string, refId: string, summary?: string): string {
  return JSON.stringify({
    format: "blocks",
    blocks: [{
      type: "reference_card",
      title,
      ref_type: refType,
      ref_id: refId,
      summary: summary ?? null,
    }],
    fallback_text: summary ?? title,
  });
}

/**
 * 解析 JSON 数组参数。
 * 单独封装而不是直接使用 JSON.parse，原因：
 * 1. 提供更清晰的错误消息（包含字段名），帮助用户定位问题参数
 * 2. 确保解析结果是数组类型，避免传入非数组 JSON 导致后续逻辑异常
 * 3. 统一所有 JSON 数组参数的解析和校验逻辑
 */
function parseJsonArray(value: string, fieldName: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error(`${fieldName} must be a JSON array`);
    return parsed;
  } catch (error) {
    throw new Error(`Invalid JSON for ${fieldName}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function printUsage(): void {
  process.stderr.write([
    "Usage:",
    "",
    "  # 文本回复（从 stdin 读取）",
    "  echo 'hello' | node .meta/skills/message-out/message-out.js text",
    "",
    "  # 带 mention 的文本回复",
    "  node .meta/skills/message-out/message-out.js text --text '已提交检视意见' --mentions 'Implementation Snail' 'Acceptance Snail'",
    "",
    "  # 用户问题卡片",
    "  node .meta/skills/message-out/message-out.js question --title '需要确认' --question '请选择方案' --options '[{\"key\":\"a\",\"label\":\"方案A\"}]'",
    "",
    "  # 问题回答",
    "  node .meta/skills/message-out/message-out.js question-response --title '需要确认' --options '[{\"key\":\"a\",\"label\":\"方案A\"}]' --summary '选择了方案A'",
    "",
    "  # Markdown 块",
    "  echo '# 标题' | node .meta/skills/message-out/message-out.js markdown",
    "",
    "  # 表格",
    "  node .meta/skills/message-out/message-out.js table --columns '[\"列1\",\"列2\"]' --rows '[[\"值1\",\"值2\"]]'",
    "",
    "  # Artifact 引用卡片",
    "  node .meta/skills/message-out/message-out.js artifact-card --title '文档标题' --summary '摘要'",
    "",
    "  # Reference 引用卡片",
    "  node .meta/skills/message-out/message-out.js reference-card --title '参考' --ref-type message --ref-id 123",
    "",
    "  # 通用 blocks（从 stdin 读取 JSON）",
    "  echo '{\"format\":\"blocks\",\"blocks\":[...]}' | node .meta/skills/message-out/message-out.js blocks",
  ].join("\n") + "\n");
}

async function buildTextCommandPayload(namedArgs: Record<string, string[]>): Promise<string> {
  const text = getSingleArg(namedArgs, "text") ?? await readStdin();
  const mentions = getMultipleArgs(namedArgs, "mentions");
  return buildTextPayload(text, mentions);
}

function buildQuestionCommandPayload(command: string, namedArgs: Record<string, string[]>): string {
  const title = requireArg(namedArgs, "title", command);
  const question = requireArg(namedArgs, "question", command);
  const optionsJson = requireArg(namedArgs, "options", command);
  const reason = getSingleArg(namedArgs, "reason");
  const options = parseJsonArray(optionsJson, "options");
  return buildQuestionPayload(title, question, options, reason);
}

function buildQuestionResponseCommandPayload(command: string, namedArgs: Record<string, string[]>): string {
  const title = requireArg(namedArgs, "title", command);
  const optionsJson = requireArg(namedArgs, "options", command);
  const summary = requireArg(namedArgs, "summary", command);
  const selectionMode = getSingleArg(namedArgs, "selection-mode") ?? "single";
  const options = parseJsonArray(optionsJson, "options");
  return buildQuestionResponsePayload(title, options, summary, selectionMode);
}

async function buildMarkdownCommandPayload(namedArgs: Record<string, string[]>): Promise<string> {
  const text = getSingleArg(namedArgs, "text") ?? await readStdin();
  return buildMarkdownPayload(text);
}

function buildTableCommandPayload(command: string, namedArgs: Record<string, string[]>): string {
  const columnsJson = requireArg(namedArgs, "columns", command);
  const rowsJson = requireArg(namedArgs, "rows", command);
  const title = getSingleArg(namedArgs, "title");
  const columns = parseJsonArray(columnsJson, "columns") as string[];
  const rows = parseJsonArray(rowsJson, "rows") as unknown[][];
  return buildTablePayload(title, columns, rows);
}

function buildArtifactCardCommandPayload(command: string, namedArgs: Record<string, string[]>): string {
  const title = requireArg(namedArgs, "title", command);
  const summary = getSingleArg(namedArgs, "summary");
  const artifactId = getSingleArg(namedArgs, "artifact-id");
  const artifactType = getSingleArg(namedArgs, "artifact-type");
  return buildArtifactCardPayload(title, summary, artifactId, artifactType);
}

function buildReferenceCardCommandPayload(command: string, namedArgs: Record<string, string[]>): string {
  const title = requireArg(namedArgs, "title", command);
  const refType = requireArg(namedArgs, "ref-type", command);
  const refId = requireArg(namedArgs, "ref-id", command);
  const summary = getSingleArg(namedArgs, "summary");
  return buildReferenceCardPayload(title, refType, refId, summary);
}

async function buildPayloadForCommand(command: string, namedArgs: Record<string, string[]>): Promise<string> {
  if (command === "text") return buildTextCommandPayload(namedArgs);
  if (command === "question") return buildQuestionCommandPayload(command, namedArgs);
  if (command === "question-response") return buildQuestionResponseCommandPayload(command, namedArgs);
  if (command === "markdown") return buildMarkdownCommandPayload(namedArgs);
  if (command === "table") return buildTableCommandPayload(command, namedArgs);
  if (command === "artifact-card") return buildArtifactCardCommandPayload(command, namedArgs);
  if (command === "reference-card") return buildReferenceCardCommandPayload(command, namedArgs);
  // blocks command: read from stdin
  return readStdin();
}

async function main(): Promise<void> {
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
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
