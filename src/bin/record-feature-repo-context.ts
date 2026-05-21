#!/usr/bin/env node

import path from "path";
import fs from "fs";
import { ConversationStore } from "../persistence/store";

interface ParsedArgs {
  featureId?: string;
  stageId?: string;
  entries: Record<string, string>;
  dbPath: string;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const store = new ConversationStore(args.dbPath);
  try {
    const stageId = resolveStageId(args, store);
    const stage = store.getStage(stageId);
    if (!stage) fail(`Stage not found: ${stageId}`);
    const feature = store.getFeature(stage.feature_id);
    if (!feature) fail(`Feature not found: ${stage.feature_id}`);
    if (feature.status === "archived") fail("Archived feature is read-only");

    // Merge new entries into existing output_artifacts
    const updated: Record<string, string> = { ...stage.output_artifacts, ...args.entries };
    const result = store.updateStage(stageId, { output_artifacts: updated });

    process.stdout.write(`${JSON.stringify({
      stage_id: result.id,
      feature_id: result.feature_id,
      output_artifacts: result.output_artifacts,
    }, null, 2)}\n`);
  } finally {
    store.close();
  }
}

function resolveStageId(args: ParsedArgs, store: ConversationStore): string {
  if (args.stageId) return args.stageId;
  if (args.featureId) {
    const activeStage = store.getActiveStage(args.featureId);
    if (activeStage) return activeStage.id;
    fail(`No active stage found for feature: ${args.featureId}`);
  }
  fail("Either --stage-id or --feature-id is required");
}

function parseArgs(argv: string[]): ParsedArgs {
  const getValue = (name: string): string => {
    const index = argv.indexOf(name);
    if (index === -1 || index === argv.length - 1) return "";
    return argv[index + 1] ?? "";
  };

  const featureId = optionalArg(getValue("--feature-id"));
  const stageId = optionalArg(getValue("--stage-id"));
  const dbPath = getValue("--db-path") || process.env.DB_PATH || resolveDefaultDbPath();

  // Parse --set key=value pairs
  const entries: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--set" && i + 1 < argv.length) {
      const pair = argv[i + 1];
      const eqIndex = pair.indexOf("=");
      if (eqIndex > 0) {
        const key = pair.substring(0, eqIndex).trim();
        const value = pair.substring(eqIndex + 1).trim();
        if (key) entries[key] = value;
      }
    }
  }

  if (!featureId && !stageId) fail("--feature-id or --stage-id is required");
  if (Object.keys(entries).length === 0) fail("At least one --set key=value pair is required");

  return { featureId, stageId, entries, dbPath };
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

function fail(message: string): never {
  throw new Error(message);
}

main();
