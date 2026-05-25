#!/usr/bin/env node
"use strict";

// query-current-context skill — 运行时上下文查询入口。
// 不直接访问数据库；通过 db-bridge 共享桥接层完成数据操作。

const { execFileSync } = require("child_process");
const path = require("path");

const BRIDGE = path.join(__dirname, "..", "..", "..", "scripts", "db-bridge.js");

function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  if (modeIndex !== -1) args.splice(modeIndex, 2);
  args.unshift("--mode", "context-query");

  try {
    const result = execFileSync(process.execPath, [BRIDGE, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(result);
  } catch (e) {
    process.stderr.write(e.stderr || e.message || "");
    process.exit(e.status || 1);
  }
}

main();
