#!/usr/bin/env node

import path from "path";
import fs from "fs";
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
    if (!feature) failFeatureNotFound(args);
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
  const dbPath = getValue("--db-path") || process.env.DB_PATH || resolveDefaultDbPath();

  if (!featureId) fail("--feature-id is required");
  if (!branchName && !worktreePath && !prUrl) fail("At least one of --branch-name, --worktree-path or --pr-url is required");

  return { featureId, branchName, worktreePath, prUrl, dbPath };
}

function optionalArg(value: string): string | undefined {
  return value === "" ? undefined : value;
}

function resolveDefaultDbPath(): string {
  return path.join(resolvePrimaryRepoRoot(resolveScriptRepoRoot()), "data", "snail-shell.db");
}

function resolveScriptRepoRoot(): string {
  const packageRoot = findAncestorWithFile(__dirname, "package.json");
  return packageRoot ?? process.cwd();
}

function resolvePrimaryRepoRoot(cwd: string): string {
  const repoRoot = findAncestorWithFile(cwd, ".git");
  if (!repoRoot) return cwd;

  const gitPath = path.join(repoRoot, ".git");
  if (fs.statSync(gitPath).isDirectory()) return repoRoot;

  const gitFile = fs.readFileSync(gitPath, "utf8").trim();
  const gitDirMatch = /^gitdir:\s*(.+)$/i.exec(gitFile);
  if (!gitDirMatch) return repoRoot;

  const gitDir = path.resolve(repoRoot, gitDirMatch[1]);
  const commonDirFile = path.join(gitDir, "commondir");
  if (!fs.existsSync(commonDirFile)) return repoRoot;

  const commonGitDir = path.resolve(gitDir, fs.readFileSync(commonDirFile, "utf8").trim());
  return path.basename(commonGitDir) === ".git" ? path.dirname(commonGitDir) : repoRoot;
}

function findAncestorWithFile(startDir: string, fileName: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, fileName))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function failFeatureNotFound(args: ParsedArgs): never {
  fail([
    `Feature not found: ${args.featureId}`,
    `Checked database: ${args.dbPath}`,
    "record-feature-repo-context only updates a Feature that already exists in the Snail Shell database.",
    "If this id only exists as a docs/features file, create or select the Feature through the Snail Shell workflow first.",
    "If the Feature exists in another database, rerun with --db-path or DB_PATH pointing at that database.",
  ].join("\n"));
}

function fail(message: string): never {
  throw new Error(message);
}

main();
