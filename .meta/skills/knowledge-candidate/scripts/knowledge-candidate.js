#!/usr/bin/env node
"use strict";

// knowledge-candidate skill — 知识候选创建入口。
// 不直接访问数据库；通过 db-bridge 共享桥接层完成数据操作。

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BRIDGE = path.join(__dirname, "..", "..", "..", "scripts", "db-bridge.js");

const SCOPE_TYPES = new Set(["global", "project", "feature", "stage_type", "conversation", "snail", "code_area", "workflow"]);
const KINDS = new Set(["constraint", "decision", "pattern", "anti_pattern", "term", "procedure"]);
const SOURCE_TYPES = new Set(["message", "artifact", "conversation", "stage", "feature", "project", "pull_request", "review_comment", "test_failure", "external"]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = readInput(args.inputPath);
  const input = parseCandidateInput(raw);

  // 构建 bridge 参数，通过 stdin 传递 JSON
  const bridgeArgs = ["--mode", "candidate-create"];
  if (input.project_id != null) bridgeArgs.push("--project-id", String(input.project_id));
  bridgeArgs.push("--scope-type", input.scope_type);
  if (input.scope_ref) bridgeArgs.push("--scope-ref", input.scope_ref);
  bridgeArgs.push("--kind", input.kind);
  bridgeArgs.push("--title", input.title);
  bridgeArgs.push("--content", input.content);
  if (input.rationale) bridgeArgs.push("--rationale", input.rationale);
  if (input.created_by) bridgeArgs.push("--created-by", input.created_by);
  if (input.metadata) bridgeArgs.push("--metadata", JSON.stringify(input.metadata));
  if (input.sources && input.sources.length > 0) {
    const mappedSources = input.sources.map((s) => ({
      sourceType: s.source_type ?? s.sourceType,
      sourceId: s.source_id ?? s.sourceId ?? "manual",
      quote: s.quote ?? null,
    }));
    bridgeArgs.push("--sources", JSON.stringify(mappedSources));
  }

  try {
    const result = execFileSync(process.execPath, [BRIDGE, ...bridgeArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(result);
  } catch (e) {
    process.stderr.write(e.stderr || e.message || "");
    process.exit(e.status || 1);
  }
}

function parseArgs(argv) {
  const getValue = (name) => { const i = argv.indexOf(name); return (i >= 0 && i < argv.length - 1) ? (argv[i + 1] ?? "") : ""; };
  return { inputPath: getValue("--input") || null };
}

function readInput(inputPath) {
  const raw = inputPath ? fs.readFileSync(inputPath, "utf8") : fs.readFileSync(0, "utf8");
  if (!raw.trim()) throw new Error("knowledge candidate input is required");
  return raw;
}

function parseCandidateInput(raw) {
  const parsed = JSON.parse(raw);
  const err = validate(parsed);
  if (err) throw new Error(err);
  return parsed;
}

function validate(input) {
  if (!stringValue(input.title)) return "title is required";
  if (!stringValue(input.content)) return "content is required";
  if (!enumValue(input.scope_type, SCOPE_TYPES)) return "scope_type is invalid";
  if (!enumValue(input.kind, KINDS)) return "kind is invalid";
  if (input.sources !== void 0 && !Array.isArray(input.sources)) return "sources must be an array";
  const badSource = input.sources?.find((s) => s.source_type !== void 0 && !enumValue(s.source_type, SOURCE_TYPES));
  if (badSource) return "source_type is invalid";
  return null;
}

function stringValue(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function enumValue(value, allowed) { return typeof value === "string" && allowed.has(value) ? value : null; }

main();
