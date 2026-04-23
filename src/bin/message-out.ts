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

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  message-out text --payload '{\"format\":\"plain_text\",\"content\":\"hello\"}'",
      "  message-out question --payload '{\"format\":\"question\",...}'",
      "  message-out question-response --payload '{\"format\":\"question_response\",...}'",
      "  message-out <command> < payload.json",
    ].join("\n") + "\n"
  );
}

async function main(): Promise<void> {
  const { command, payload } = parseArgs(process.argv.slice(2));
  if (!command || !["text", "question", "question-response"].includes(command)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const rawInput = payload ?? await readStdin();
  const part = parseMessageOutPayload(rawInput);

  if (command === "text" && (part.payload.format === "question" || part.payload.format === "question_response")) {
    throw new Error("text command only accepts plain_text or structured_text payloads");
  }
  if (command === "question" && part.payload.format !== "question") {
    throw new Error("question command only accepts question payloads");
  }
  if (command === "question-response" && part.payload.format !== "question_response") {
    throw new Error("question-response command only accepts question_response payloads");
  }

  process.stdout.write(stringifyMessageOutPart(part));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
