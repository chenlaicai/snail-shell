#!/usr/bin/env node
"use strict";

// evolution-candidate skill — 演进候选创建入口。
// 不直接访问数据库；通过 db-bridge 共享桥接层完成数据操作。

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function findBridge() {
  const sibling = path.join(__dirname, "..", "..", "..", "scripts", "db-bridge.js");
  if (fs.existsSync(sibling)) return sibling;
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".meta", "scripts", "db-bridge.js");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = __dirname;
  while (true) {
    const candidate = path.join(dir, ".meta", "scripts", "db-bridge.js");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return sibling;
}

const BRIDGE = findBridge();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = readInput(args.inputPath);
  const input = parseCandidateInput(raw);

  // 构建 bridge 参数，通过 stdin 传递 JSON
  const bridgeArgs = ["--mode", "evolution-create"];
  bridgeArgs.push("--project-id", input.project_id);
  bridgeArgs.push("--title", input.title);
  bridgeArgs.push("--content", input.content);
  if (input.tags && input.tags.length > 0) bridgeArgs.push("--tags", JSON.stringify(input.tags));
  if (input.metadata) bridgeArgs.push("--metadata", JSON.stringify(input.metadata));

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
  if (!raw.trim()) throw new Error("evolution candidate input is required");
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
  if (!stringValue(input.project_id)) return "project_id is required";
  if (input.tags !== undefined && !Array.isArray(input.tags)) return "tags must be an array";
  return null;
}

function stringValue(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }

main();
