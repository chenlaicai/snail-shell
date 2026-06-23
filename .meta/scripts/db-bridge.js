#!/usr/bin/env node
"use strict";

// db-bridge — 共享数据访问层。对 AI 不可见。
// 所有 skill 通过此桥接访问数据库，不直接传 --db-path。
// DB 路径仅通过 DB_PATH 环境变量或默认路径解析。

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const repoRoot = findRepoRoot(process.cwd());
  return path.join(repoRoot, "data", "database", "snail-shell.db");
}

function findRepoRoot(startDir) {
  // Walk up to find .git
  let dir = path.resolve(startDir);
  while (true) {
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) return dir;
      // .git is a file → worktree, parse gitdir to find shared repo
      const gitFile = fs.readFileSync(gitPath, "utf8").trim();
      const m = /^gitdir:\s*(.+)$/i.exec(gitFile);
      if (m) {
        const gitDir = path.resolve(dir, m[1]);
        const commonDirFile = path.join(gitDir, "commondir");
        if (fs.existsSync(commonDirFile)) {
          const commonGitDir = path.resolve(gitDir, fs.readFileSync(commonDirFile, "utf8").trim());
          if (path.basename(commonGitDir) === ".git") return path.dirname(commonGitDir);
        }
      }
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function openDb() {
  return new Database(resolveDbPath());
}

// ── CLI entry (internal use by skill scripts) ────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  switch (args.mode) {
    case "stage-record-context": {
      if (!args.stageId) fail("--stage-id is required");
      if (!args.entries) fail("--entries is required (JSON object)");
      const db = openDb();
      try {
        const stage = db.prepare("SELECT * FROM stage WHERE id = ?").get(args.stageId);
        if (!stage) fail(`Stage not found: ${args.stageId}`);
        const issue = db.prepare("SELECT * FROM issue WHERE id = ?").get(stage.issue_id);
        if (!issue) fail(`Issue not found: ${stage.issue_id}`);
        if (issue.closed_at) fail("Archived issue is read-only");

        // 双写：同时更新 Stage.output_artifacts 和 Issue.context
        let currentArtifacts = {};
        try { currentArtifacts = JSON.parse(stage.output_artifacts || "{}"); } catch (_) {}
        const entries = JSON.parse(args.entries);
        const updatedArtifacts = { ...currentArtifacts, ...entries };
        db.prepare("UPDATE stage SET output_artifacts = ? WHERE id = ?").run(JSON.stringify(updatedArtifacts), args.stageId);

        // 双写到 Issue.context
        let currentContext = {};
        try { currentContext = JSON.parse(issue.context || "{}"); } catch (_) {}
        const updatedContext = { ...currentContext, ...entries };
        db.prepare("UPDATE issue SET context = ? WHERE id = ?").run(JSON.stringify(updatedContext), stage.issue_id);

        result = {
          stage_id: stage.id,
          issue_id: stage.issue_id,
          issue_title: issue.title,
          stage_type: stage.type,
          output_artifacts: updatedArtifacts,
          issue_context: updatedContext,
        };
      } finally { db.close(); }
      break;
    }
    case "stage-get-active": {
      if (!args.issueId) fail("--issue-id is required");
      const db = openDb();
      try {
        const stage = db.prepare(
          "SELECT * FROM stage WHERE issue_id = ? AND status = 'in_progress' ORDER BY sequence DESC LIMIT 1"
        ).get(args.issueId);
        result = stage ? { stage } : { stage: null };
      } finally { db.close(); }
      break;
    }
    case "stage-list-for-workdir": {
      // 返回所有 stage 的 worktree_path 映射，供 wrapper 做 auto-discovery
      const db = openDb();
      try {
        const rows = db.prepare("SELECT id, output_artifacts FROM stage WHERE output_artifacts IS NOT NULL AND output_artifacts != ''").all();
        const stages = rows.map((r) => {
          let artifacts = {};
          try { artifacts = JSON.parse(r.output_artifacts || "{}"); } catch (_) {}
          return { id: r.id, worktree_path: artifacts.worktree_path || null };
        }).filter((s) => s.worktree_path);
        result = { stages };
      } finally { db.close(); }
      break;
    }
    default:
      fail(`Unsupported mode: ${args.mode}`);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function parseArgs(argv) {
  const getValue = (name) => { const i = argv.indexOf(name); return (i === -1 || i === argv.length - 1) ? "" : (argv[i + 1] ?? ""); };
  const optStr = (name) => getValue(name) || undefined;
  const mode = getValue("--mode");
  if (!mode) fail("--mode is required");
  return {
    mode,
    stageId: optStr("--stage-id") || process.env.SNAIL_CTX_STAGE_ID || undefined,
    issueId: optStr("--issue-id") || process.env.SNAIL_CTX_ISSUE_ID || undefined,
    entries: optStr("--entries"),
  };
}

function fail(message) { process.stderr.write(message + "\n"); process.exit(1); }

// Run as CLI when executed directly; also usable as require() module
if (require.main === module) {
  main();
}

module.exports = { openDb, resolveDbPath };
