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

function parseArgs(argv: string[]): { command: string; payload: string | null } {
  const [command, ...rest] = argv;
  const payloadIndex = rest.findIndex((item) => item === "--payload");
  if (payloadIndex >= 0) {
    const payload = rest[payloadIndex + 1];
    if (typeof payload !== "string") throw new Error("--payload requires a JSON string");
    return { command: command ?? "", payload };
  }
  return { command: command ?? "", payload: null };
}

function blocksPayloadForCommand(command: string, payload: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    if (command === "text") return JSON.stringify({ format: "blocks", blocks: [{ type: "text", text: payload }], fallback_text: payload });
    if (command === "markdown") return JSON.stringify({ format: "blocks", blocks: [{ type: "markdown", text: payload }], fallback_text: payload });
    throw error;
  }
  if (!parsed || typeof parsed !== "object") throw new Error(`${command} payload must be a JSON object`);
  const data = parsed as Record<string, unknown>;
  if (command === "text") return JSON.stringify({ format: "blocks", blocks: [{ type: "text", text: data.text, ...(Array.isArray(data.mentions) ? { mentions: data.mentions } : {}) }], fallback_text: data.text });
  if (command === "question") return JSON.stringify({ format: "blocks", blocks: [{ type: "question", ...data }], fallback_text: `${data.title || "需要你的确认"}\n${data.question || ""}`.trim() });
  if (command === "question-response") return JSON.stringify({ format: "blocks", blocks: [{ type: "question_response", ...data }], fallback_text: data.summary || "" });
  if (command === "markdown") return JSON.stringify({ format: "blocks", blocks: [{ type: "markdown", text: data.text }], fallback_text: data.text });
  if (command === "table") return JSON.stringify({ format: "blocks", blocks: [{ type: "table", title: data.title, columns: data.columns, rows: data.rows }], fallback_text: data.title || "table" });
  if (command === "artifact-card") return JSON.stringify({ format: "blocks", blocks: [{ type: "artifact_card", ...data }], fallback_text: data.summary || data.title || "artifact" });
  if (command === "reference-card") return JSON.stringify({ format: "blocks", blocks: [{ type: "reference_card", ...data }], fallback_text: data.summary || data.title || "reference" });
  return payload;
}

function printUsage(): void {
  process.stderr.write([
    "Usage:",
    "  node .meta/skills/message-out/message-out.js text < reply.md",
    "  node .meta/skills/message-out/message-out.js text --payload '{\"text\":\"hello\",\"mentions\":[\"Product Snail\"]}'",
    "  node .meta/skills/message-out/message-out.js blocks --payload '{\"format\":\"blocks\",\"blocks\":[{\"type\":\"text\",\"text\":\"hello\"}]}'",
    "  node .meta/skills/message-out/message-out.js question --payload '{\"title\":\"需要你的确认\",\"question\":\"请选择一个方案\",...}'",
    "  node .meta/skills/message-out/message-out.js question-response --payload '{\"response_to\":{\"title\":\"需要你的确认\"},...}'",
    "  node .meta/skills/message-out/message-out.js <command> < payload.json",
  ].join("\n") + "\n");
}

async function main(): Promise<void> {
  const { command, payload } = parseArgs(process.argv.slice(2));
  if (!command || !["text", "blocks", "question", "question-response", "markdown", "table", "artifact-card", "reference-card"].includes(command)) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const rawInput = payload ?? await readStdin();
  const normalizedInput = command === "blocks" ? rawInput : blocksPayloadForCommand(command, rawInput);
  const event = parseMessageOutPayload(normalizedInput);
  if (event.kind !== "content_block") throw new Error(`${command} command must produce a content_block event`);
  process.stdout.write(stringifyMessageOutPart(event));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
