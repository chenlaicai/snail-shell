#!/usr/bin/env node

import path from "path";
import { ConversationStore } from "../persistence/store";

interface ParsedArgs {
  featureId: string;
  branchName?: string;
  worktreePath?: string;
  prUrl?: string;
  dbPath: string;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const store = new ConversationStore(args.dbPath);
  try {
    const feature = store.getFeature(args.featureId);
    if (!feature) fail(`Feature not found: ${args.featureId}`);
    if (feature.status === "archived") fail("Archived feature is read-only");
    const updated = store.updateFeature(args.featureId, {
      branch_name: args.branchName ?? feature.branch_name,
      worktree_path: args.worktreePath ?? feature.worktree_path,
      pr_url: args.prUrl ?? feature.pr_url,
    });
    process.stdout.write(`${JSON.stringify({
      feature_id: updated.id,
      branch_name: updated.branch_name,
      worktree_path: updated.worktree_path,
      pr_url: updated.pr_url,
    }, null, 2)}\n`);
  } finally {
    store.close();
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const getValue = (name: string): string => {
    const index = argv.indexOf(name);
    if (index === -1 || index === argv.length - 1) return "";
    return argv[index + 1] ?? "";
  };
  const featureId = getValue("--feature-id");
  const branchName = optionalArg(getValue("--branch-name"));
  const worktreePath = optionalArg(getValue("--worktree-path"));
  const prUrl = optionalArg(getValue("--pr-url"));
  const dbPath = getValue("--db-path") || process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");

  if (!featureId) fail("--feature-id is required");
  if (!branchName && !worktreePath && !prUrl) fail("At least one of --branch-name, --worktree-path or --pr-url is required");

  return { featureId, branchName, worktreePath, prUrl, dbPath };
}

function optionalArg(value: string): string | undefined {
  return value === "" ? undefined : value;
}

function fail(message: string): never {
  throw new Error(message);
}

main();
