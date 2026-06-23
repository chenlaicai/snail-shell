#!/usr/bin/env node
"use strict";

// record-issue-repo-context skill — Issue repo 上下文记录入口。
// 写入 Issue 级别 context（而非 Stage 的 output_artifacts）。
// Key 前缀自动注入：根据当前 Stage 的 key 自动添加前缀（如 dev.worktree_path）。

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const DEFAULT_API_BASE = "http://localhost:3000";

function main() {
  const argv = process.argv.slice(2);
  const getValue = (name) => { const i = argv.indexOf(name); return (i >= 0 && i < argv.length - 1) ? argv[i + 1] : ""; };
  const apiBase = getValue("--api-base") || DEFAULT_API_BASE;
  const issueId = optionalArg(getValue("--issue-id"));
  const stageId = optionalArg(getValue("--stage-id"));
  const stageKey = optionalArg(getValue("--stage-key"));

  // Parse --set key=value pairs
  const entries = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--set" && i + 1 < argv.length) {
      const pair = argv[i + 1];
      const eqIndex = pair.indexOf("=");
      if (eqIndex > 0) {
        const key = pair.substring(0, eqIndex).trim();
        const value = pair.substring(eqIndex + 1).trim();
        if (key) {
          // Try to parse JSON values (objects/arrays) so {value, keep} is stored as an object
          if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
            try { entries[key] = JSON.parse(value); } catch (_) { entries[key] = value; }
          } else {
            entries[key] = value;
          }
        }
      }
    }
  }

  if (Object.keys(entries).length === 0) {
    process.stderr.write("At least one --set key=value pair is required\n");
    process.exit(1);
  }

  // Issue resolution
  let resolvedIssueId = issueId;
  let discoveryMethod = "";

  if (!resolvedIssueId && stageId) {
    // Get issue_id from stage
    try {
      const stageData = fetchJson(`${apiBase}/api/stages/${stageId}`);
      if (stageData && stageData.issue_id) {
        resolvedIssueId = stageData.issue_id;
        discoveryMethod = "stage-id";
      }
    } catch (e) {
      process.stderr.write(`Failed to get stage ${stageId}: ${e.message}\n`);
      process.exit(1);
    }
  }

  if (!resolvedIssueId) {
    process.stderr.write(
      "Could not determine target issue.\n" +
      "Pass --issue-id {{issue_id}} or --stage-id {{stage_id}} (system prompt context) for reliable use.\n"
    );
    process.exit(1);
  }

  if (!discoveryMethod) discoveryMethod = "issue-id";

  // Key 前缀自动注入：根据 stageKey 添加前缀
  const prefixedEntries = {};
  if (stageKey) {
    for (const [key, value] of Object.entries(entries)) {
      prefixedEntries[`${stageKey}.${key}`] = value;
    }
  } else {
    Object.assign(prefixedEntries, entries);
  }

  // Write to Issue.context via API
  try {
    const result = fetchJson(`${apiBase}/api/issues/${resolvedIssueId}/context`, "PATCH", prefixedEntries);
    process.stdout.write(JSON.stringify({
      issue_id: resolvedIssueId,
      discovered_by: discoveryMethod,
      context: result.context ?? {},
    }, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(`Failed to update issue context: ${e.message}\n`);
    process.exit(1);
  }
}

function fetchJson(url, method = "GET", body = null) {
  const { execFileSync } = require("child_process");
  const args = ["-s", "-X", method, url];
  if (body) {
    args.push("-H", "Content-Type: application/json");
    args.push("-d", JSON.stringify(body));
  }
  const raw = execFileSync("curl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(raw);
}

function optionalArg(value) { return value === "" ? undefined : value; }

try { main(); } catch (e) { process.stderr.write(e.stderr || e.message + "\n"); process.exit(e.status || 1); }
