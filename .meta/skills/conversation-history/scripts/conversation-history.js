#!/usr/bin/env node
"use strict";

// conversation-history skill — 历史消息查询入口。
// 不直接访问数据库；通过 db-bridge 共享桥接层完成数据操作。

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

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
const MODES = ["recent", "page", "search", "by-ids", "window", "reindex", "search-by-issue"];

function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  if (modeIndex === -1 || modeIndex === args.length - 1) {
    process.stderr.write("--mode is required\n");
    process.exit(1);
  }
  const mode = args[modeIndex + 1];
  if (!MODES.includes(mode)) {
    process.stderr.write(`Invalid --mode value: ${mode}\n`);
    process.exit(1);
  }
  args[modeIndex + 1] = "history-" + mode;

  try {
    const result = execFileSync(process.execPath, [BRIDGE, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(result);
  } catch (e) {
    process.stderr.write(e.stderr || e.message || "");
    process.exit(e.status || 1);
  }
}

main();
