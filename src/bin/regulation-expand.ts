#!/usr/bin/env node

import { getPrompt, listPrompts } from "../prompt-center";

type OutputFormat = "markdown" | "json";

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.id) {
    fail("--id is required");
  }

  const prompt = getPrompt(args.id);
  if (args.format === "json") {
    const indexEntry = listPrompts().find((item) => item.id === args.id);
    process.stdout.write(`${JSON.stringify({
      id: args.id,
      file_path: prompt.filePath,
      index: indexEntry ?? null,
      content: prompt.content,
    }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${prompt.content}\n`);
}

function parseArgs(argv: string[]): { id: string; format: OutputFormat } {
  const getValue = (name: string): string => {
    const index = argv.indexOf(name);
    if (index === -1 || index === argv.length - 1) {
      return "";
    }
    return argv[index + 1] ?? "";
  };

  const id = getValue("--id");
  const formatRaw = getValue("--format") || "markdown";
  if (!["markdown", "json"].includes(formatRaw)) {
    fail(`Invalid --format value: ${formatRaw}`);
  }

  return {
    id,
    format: formatRaw as OutputFormat,
  };
}

function fail(message: string): never {
  throw new Error(message);
}

main();
