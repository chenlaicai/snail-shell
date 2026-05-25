#!/usr/bin/env node
"use strict";

// record-feature-repo-context skill — Repo 上下文记录入口。
// 不直接访问数据库；通过 db-bridge 共享桥接层完成数据操作。

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BRIDGE = path.join(__dirname, "..", "..", "..", "scripts", "db-bridge.js");

function main() {
  const args = process.argv.slice(2);

  // 提取 --context-name 和 --context-value，合并为 --entries JSON
  const getValue = (name) => { const i = args.indexOf(name); return (i >= 0 && i < args.length - 1) ? args[i + 1] : ""; };
  const contextName = getValue("--context-name");
  const contextValue = getValue("--context-value");
  if (!contextName) { process.stderr.write("--context-name is required\n"); process.exit(1); }
  if (!contextValue) { process.stderr.write("--context-value is required\n"); process.exit(1); }

  // 清理旧参数，重建 bridge args
  const bridgeArgs = ["--mode", "stage-record-context", "--entries", JSON.stringify({ [contextName]: contextValue })];

  const stageId = getValue("--stage-id");
  if (stageId) {
    bridgeArgs.push("--stage-id", stageId);
  } else {
    // 尝试从 worktree 路径解析 stage id
    const workdirStage = getValue("--workdir") || process.cwd();
    if (workdirStage) {
      bridgeArgs.push("--workdir", workdirStage);
    }
  }

  try {
    const result = execFileSync(process.execPath, [BRIDGE, ...bridgeArgs], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(result);
  } catch (e) {
    process.stderr.write(e.stderr || e.message || "");
    process.exit(e.status || 1);
  }
}

main();
