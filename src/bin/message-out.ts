import { parseMessageOutPayload, stringifyMessageOutPart } from "../project/message-out";

async function readStdin(): Promise<string> {
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

function parseArgs(argv: string[]): { command: string; payload: string | null } {
  const [command, ...rest] = argv;
  const payloadIndex = rest.findIndex((item) => item === "--payload");
  if (payloadIndex >= 0) {
    const payload = rest[payloadIndex + 1];
    if (typeof payload !== "string") {
      throw new Error("--payload requires a JSON string");
    }
    return { command: command ?? "", payload };
  }
  return { command: command ?? "", payload: null };
}

function blocksPayloadForCommand(command: string, payload: string): string {
  const parsed = JSON.parse(payload);
  if (command === "text") {
    return JSON.stringify({ format: "blocks", blocks: [{ type: "text", text: parsed.text, ...(Array.isArray(parsed.mentions) ? { mentions: parsed.mentions } : {}) }], fallback_text: parsed.text });
  }
  if (command === "question") {
    return JSON.stringify({ format: "blocks", blocks: [{ type: "question", ...parsed }], fallback_text: `${parsed.title || "需要你的确认"}\n${parsed.question || ""}`.trim() });
  }
  if (command === "question-response") {
    return JSON.stringify({ format: "blocks", blocks: [{ type: "question_response", ...parsed }], fallback_text: parsed.summary || "" });
  }
  if (command === "markdown") {
    return JSON.stringify({ format: "blocks", blocks: [{ type: "markdown", text: parsed.text }], fallback_text: parsed.text });
  }
  if (command === "table") {
    return JSON.stringify({ format: "blocks", blocks: [{ type: "table", title: parsed.title, columns: parsed.columns, rows: parsed.rows }], fallback_text: parsed.title || "table" });
  }
  if (command === "artifact-card") {
    return JSON.stringify({ format: "blocks", blocks: [{ type: "artifact_card", ...parsed }], fallback_text: parsed.summary || parsed.title || "artifact" });
  }
  if (command === "reference-card") {
    return JSON.stringify({ format: "blocks", blocks: [{ type: "reference_card", ...parsed }], fallback_text: parsed.summary || parsed.title || "reference" });
  }
  return payload;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  node dist/src/bin/message-out.js text --payload '{\"text\":\"hello\",\"mentions\":[\"Product Snail\"]}'",
      "  node dist/src/bin/message-out.js blocks --payload '{\"format\":\"blocks\",\"blocks\":[{\"type\":\"text\",\"text\":\"hello\"}]}'",
      "  node dist/src/bin/message-out.js question --payload '{\"title\":\"需要你的确认\",\"question\":\"请选择一个方案\",...}'",
      "  node dist/src/bin/message-out.js question-response --payload '{\"response_to\":{\"title\":\"需要你的确认\"},...}'",
      "  node dist/src/bin/message-out.js markdown --payload '{\"text\":\"# 标题\\n正文\"}'",
      "  node dist/src/bin/message-out.js table --payload '{\"title\":\"结果表\",\"columns\":[\"A\",\"B\"],\"rows\":[[1,2]]}'",
      "  node dist/src/bin/message-out.js artifact-card --payload '{\"title\":\"Project Charter\",\"artifact_type\":\"project_charter\"}'",
      "  node dist/src/bin/message-out.js reference-card --payload '{\"title\":\"引用消息\",\"ref_type\":\"message\"}'",
      "  node dist/src/bin/message-out.js <command> < payload.json",
    ].join("\n") + "\n"
  );
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
  const part = parseMessageOutPayload(normalizedInput);

  if (command === "text" && part.payload.format !== "blocks") {
    throw new Error("text command only accepts blocks payloads generated from text content");
  }
  if (command === "blocks" && part.payload.format !== "blocks") {
    throw new Error("blocks command only accepts blocks payloads");
  }
  if (command === "question" && !(part.payload.format === "blocks" && part.payload.blocks.some((block) => block.type === "question"))) {
    throw new Error("question command only accepts blocks payloads containing a question block");
  }
  if (command === "question-response" && !(part.payload.format === "blocks" && part.payload.blocks.some((block) => block.type === "question_response"))) {
    throw new Error("question-response command only accepts blocks payloads containing a question_response block");
  }
  if (command === "markdown" && !(part.payload.format === "blocks" && part.payload.blocks.some((block) => block.type === "markdown"))) {
    throw new Error("markdown command only accepts blocks payloads containing a markdown block");
  }
  if (command === "table" && !(part.payload.format === "blocks" && part.payload.blocks.some((block) => block.type === "table"))) {
    throw new Error("table command only accepts blocks payloads containing a table block");
  }
  if (command === "artifact-card" && !(part.payload.format === "blocks" && part.payload.blocks.some((block) => block.type === "artifact_card"))) {
    throw new Error("artifact-card command only accepts blocks payloads containing an artifact_card block");
  }
  if (command === "reference-card" && !(part.payload.format === "blocks" && part.payload.blocks.some((block) => block.type === "reference_card"))) {
    throw new Error("reference-card command only accepts blocks payloads containing a reference_card block");
  }

  process.stdout.write(stringifyMessageOutPart(part));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
