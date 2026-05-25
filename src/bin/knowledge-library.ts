#!/usr/bin/env node
// Knowledge Library skill script entry point.
// Bundled to .meta/skills/knowledge-library/scripts/knowledge-library.js

import path from "path";
import { randomUUID } from "crypto";
import { ConversationStore } from "../persistence/store";

interface Args {
  mode: string;
  dbPath: string;
  query?: string;
  kind?: string;
  status?: string;
  projectId: string | null | undefined;
  id?: string;
  title?: string;
  summary?: string;
  useScenarios?: string;
  nonUseScenarios?: string;
  content?: string;
  sourceKnowledgeId?: string;
  limit: number;
  offset: number;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const store = new ConversationStore(args.dbPath);
  try {
    process.stdout.write(`${JSON.stringify(executeMode(store, args), null, 2)}\n`);
  } finally {
    store.close();
  }
}

function executeMode(store: ConversationStore, args: Args): unknown {
  const status = args.status ?? undefined;
  switch (args.mode) {
    case "summary":
      return {
        mode: args.mode,
        categories: store.getKnowledgeLibraryKindSummaries(args.projectId),
      };
    case "list":
      if (!args.kind) fail("--kind is required for list mode");
      return {
        mode: args.mode,
        kind: args.kind,
        items: store.listKnowledgeLibrary({
          projectId: args.projectId,
          kind: args.kind as any,
          status: status as any,
          limit: args.limit,
          offset: args.offset,
        }),
      };
    case "get":
      if (!args.id) fail("--id is required for get mode");
      return { mode: args.mode, entry: store.getKnowledgeLibraryEntry(args.id) };
    case "search":
      if (!args.query?.trim()) fail("--query is required for search mode");
      return {
        mode: args.mode,
        query: args.query,
        items: store.searchKnowledgeLibrary({
          query: args.query,
          projectId: args.projectId,
          kind: args.kind as any,
          status: status as any,
          limit: args.limit,
          offset: args.offset,
        }),
      };
    case "create":
      return executeCreate(store, args);
    case "deprecate":
      if (!args.id) fail("--id is required for deprecate mode");
      store.deprecateKnowledgeLibraryEntry(args.id);
      return { ok: true, entry_id: args.id };
    default:
      fail(`Unsupported mode: ${String(args.mode)}`);
  }
}

function executeCreate(store: ConversationStore, args: Args): unknown {
  if (!args.kind) fail("--kind is required for create mode");
  if (!args.title) fail("--title is required for create mode");
  if (!args.content) fail("--content is required for create mode");
  if (!args.summary) fail("--summary is required for create mode");
  if (!args.useScenarios) fail("--use-scenarios is required for create mode");
  if (!args.nonUseScenarios) fail("--non-use-scenarios is required for create mode");
  const entry = store.createKnowledgeLibraryEntry({
    id: randomUUID(),
    projectId: args.projectId,
    kind: args.kind as Parameters<typeof store.createKnowledgeLibraryEntry>[0]["kind"],
    title: args.title,
    summary: args.summary,
    useScenarios: args.useScenarios,
    nonUseScenarios: args.nonUseScenarios,
    content: args.content,
    sourceKnowledgeId: args.sourceKnowledgeId ?? undefined,
  });
  return { ok: true, entry_id: entry.id };
}

function parseArgs(argv: string[]): Args {
  const getValue = (name: string): string => {
    const index = argv.indexOf(name);
    if (index === -1 || index === argv.length - 1) return "";
    return argv[index + 1] ?? "";
  };
  const optStr = (name: string): string | undefined => getValue(name) || undefined;
  const hasArg = (name: string): boolean => argv.includes(name);

  const mode = getValue("--mode");
  if (!mode) fail("--mode is required");
  if (!["summary", "list", "get", "search", "create", "deprecate"].includes(mode)) fail(`Invalid --mode value: ${mode}`);

  return {
    mode,
    dbPath: getValue("--db-path") || process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db"),
    query: optStr("--query"),
    kind: optStr("--kind"),
    status: optStr("--status"),
    projectId: hasArg("--project-id") ? parseNullable(getValue("--project-id")) : undefined,
    id: optStr("--id"),
    title: optStr("--title"),
    summary: optStr("--summary"),
    useScenarios: optStr("--use-scenarios"),
    nonUseScenarios: optStr("--non-use-scenarios"),
    content: optStr("--content"),
    sourceKnowledgeId: optStr("--source-knowledge-id"),
    limit: toPositiveInt(getValue("--limit"), 50),
    offset: toPositiveInt(getValue("--offset"), 0),
  };
}

function parseNullable(value: string): string | null {
  if (!value || value === "null") return null;
  return value;
}

function toPositiveInt(value: string, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function fail(message: string): never {
  throw new Error(message);
}

main();
