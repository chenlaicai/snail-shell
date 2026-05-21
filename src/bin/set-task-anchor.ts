#!/usr/bin/env node

import path from "path";
import fs from "fs";
import { ConversationStore } from "../persistence/store";

interface ParsedArgs {
  featureId: string;
  taskAnchor: string;
  dbPath: string;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const store = new ConversationStore(args.dbPath);
  try {
    const feature = store.getFeature(args.featureId);
    if (!feature) fail(`Feature not found: ${args.featureId}`);
    if (feature.status === "archived") fail("Archived feature is read-only");

    const result = store.updateFeature(args.featureId, { task_anchor: args.taskAnchor });

    process.stdout.write(`${JSON.stringify({
      feature_id: result.id,
      task_anchor: result.task_anchor,
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
  const taskAnchor = getValue("--task-anchor");
  const dbPath = getValue("--db-path") || process.env.DB_PATH || resolveDefaultDbPath();

  if (!featureId) fail("--feature-id is required");
  if (!taskAnchor) fail("--task-anchor is required");

  return { featureId, taskAnchor, dbPath };
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

function fail(message: string): never {
  throw new Error(message);
}

main();
