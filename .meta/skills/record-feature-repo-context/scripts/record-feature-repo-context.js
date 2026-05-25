#!/usr/bin/env node
"use strict";

// record-feature-repo-context skill — Feature repo 上下文记录入口。
// 不直接访问数据库；通过 db-bridge 完成数据操作。

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BRIDGE = path.join(__dirname, "..", "..", "..", "scripts", "db-bridge.js");

function main() {
  const argv = process.argv.slice(2);
  const getValue = (name) => { const i = argv.indexOf(name); return (i >= 0 && i < argv.length - 1) ? argv[i + 1] : ""; };
  const featureId = optionalArg(getValue("--feature-id"));
  const stageId = optionalArg(getValue("--stage-id"));

  // Parse --set key=value pairs
  const entries = {};
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
  if (Object.keys(entries).length === 0) {
    process.stderr.write("At least one --set key=value pair is required\n");
    process.exit(1);
  }

  // Stage resolution
  let resolvedStageId = stageId;
  let discoveryMethod = "";

  if (!resolvedStageId) {
    // Auto-discover from working directory
    resolvedStageId = resolveStageFromWorkdir(process.cwd());
    if (resolvedStageId) discoveryMethod = "workdir";
  }

  if (!resolvedStageId && featureId) {
    // Try feature-id lookup
    try {
      const stages = JSON.parse(execFileSync(process.execPath, [BRIDGE, "--mode", "stage-list-for-workdir"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      }));
      // Can't easily get active stage from bridge — use feature-id as last resort
      process.stderr.write(
        `No active stage found for feature "${featureId}".\n` +
        "Try running without --feature-id to auto-discover from current directory, or use --stage-id directly.\n"
      );
      process.exit(1);
    } catch (e) {
      process.stderr.write(e.stderr || e.message + "\n");
      process.exit(e.status || 1);
    }
  }

  if (!resolvedStageId) {
    process.stderr.write(
      "Could not determine target stage.\n" +
      "Pass --stage-id {{stage_id}} (system prompt context) for reliable use.\n"
    );
    process.exit(1);
  }

  if (!discoveryMethod) discoveryMethod = "stage-id";

  // Delegate to bridge
  const bridgeArgs = ["--mode", "stage-record-context", "--stage-id", resolvedStageId, "--entries", JSON.stringify(entries)];
  try {
    const raw = execFileSync(process.execPath, [BRIDGE, ...bridgeArgs], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const result = JSON.parse(raw);
    result.discovered_by = discoveryMethod;
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(e.stderr || e.message + "\n");
    process.exit(e.status || 1);
  }
}

function resolveStageFromWorkdir(cwd) {
  let resolvedCwd;
  try { resolvedCwd = fs.realpathSync(cwd); } catch (_) { return null; }

  try {
    const raw = execFileSync(process.execPath, [BRIDGE, "--mode", "stage-list-for-workdir"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const data = JSON.parse(raw);
    for (const s of data.stages) {
      if (!s.worktree_path) continue;
      let resolvedWd;
      try { resolvedWd = fs.realpathSync(s.worktree_path); } catch (_) { continue; }
      if (resolvedCwd === resolvedWd || resolvedCwd.startsWith(resolvedWd + path.sep)) return s.id;
    }
  } catch (_) {}
  return null;
}

function optionalArg(value) { return value === "" ? undefined : value; }

try { main(); } catch (e) { process.stderr.write(e.stderr || e.message + "\n"); process.exit(e.status || 1); }
