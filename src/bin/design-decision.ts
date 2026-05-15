#!/usr/bin/env node

import path from "path";
import { randomUUID } from "crypto";
import { ConversationStore } from "../persistence/store";
import type { DesignDecisionStatus } from "../shared/design-decision-types";

type Mode = "search" | "list" | "get" | "create" | "deprecate";

interface ParsedArgs {
  mode: Mode;
  dbPath: string;
  query: string;
  scopeType: string | null;
  scopeRef: string | null;
  status: string | null;
  projectId: string | null;
  id: string | null;
  title: string | null;
  content: string | null;
  sourceKnowledgeId: string | null;
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

function executeMode(store: ConversationStore, args: ParsedArgs): unknown {
  const status = (args.status ?? undefined) as DesignDecisionStatus | undefined;
  switch (args.mode) {
    case "search":
      if (!args.query.trim()) fail("--query is required for search mode");
      return { mode: args.mode, query: args.query, items: store.searchDesignDecisions({ query: args.query, projectId: args.projectId, scopeType: args.scopeType ?? undefined, status, limit: args.limit, offset: args.offset }) };
    case "list":
      return { mode: args.mode, items: store.listDesignDecisions({ projectId: args.projectId, scopeType: args.scopeType ?? undefined, scopeRef: args.scopeRef ?? undefined, status, limit: args.limit, offset: args.offset }) };
    case "get":
      if (!args.id) fail("--id is required for get mode");
      return { mode: args.mode, decision: store.getDesignDecision(args.id) };
    case "create":
      return executeCreate(store, args);
    case "deprecate":
      if (!args.id) fail("--id is required for deprecate mode");
      store.deprecateDesignDecision(args.id);
      return { ok: true, decision_id: args.id };
    default:
      fail(`Unsupported mode: ${String(args.mode)}`);
  }
}

function executeCreate(store: ConversationStore, args: ParsedArgs): unknown {
  if (!args.title) fail("--title is required for create mode");
  if (!args.content) fail("--content is required for create mode");
  if (!args.scopeType) fail("--scope-type is required for create mode");
  const decision = store.createDesignDecision({ id: randomUUID(), projectId: args.projectId, scopeType: args.scopeType, scopeRef: args.scopeRef ?? undefined, title: args.title, content: args.content, sourceKnowledgeId: args.sourceKnowledgeId ?? undefined });
  return { ok: true, decision_id: decision.id };
}

function parseArgs(argv: string[]): ParsedArgs {
  const getValue = (name: string): string => {
    const index = argv.indexOf(name);
    if (index === -1 || index === argv.length - 1) return "";
    return argv[index + 1] ?? "";
  };

  const mode = getValue("--mode") as Mode;
  if (!mode) fail("--mode is required");
  if (!["search", "list", "get", "create", "deprecate"].includes(mode)) fail(`Invalid --mode value: ${mode}`);

  return {
    mode,
    dbPath: getValue("--db-path") || process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db"),
    query: getValue("--query"),
    scopeType: getValue("--scope-type") || null,
    scopeRef: getValue("--scope-ref") || null,
    status: getValue("--status") || null,
    projectId: getValue("--project-id") || null,
    id: getValue("--id") || null,
    title: getValue("--title") || null,
    content: getValue("--content") || null,
    sourceKnowledgeId: getValue("--source-knowledge-id") || null,
    limit: toPositiveInt(getValue("--limit"), 50),
    offset: toPositiveInt(getValue("--offset"), 0),
  };
}

function toPositiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function fail(message: string): never {
  throw new Error(message);
}

main();
