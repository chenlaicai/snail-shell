#!/usr/bin/env node
/**
 * guard-bash.js — Claude Code PreToolUse Hook
 *
 * 在 Bash 工具调用执行前，对命令做语义分析，拦截危险操作。
 *
 * Claude Code PreToolUse hook 协议：
 *   stdin:  { "tool_name": "Bash", "tool_input": { "command": "...", ... } }
 *   stdout: { "decision": "allow" | "deny" | "ask", "reason": "..." }
 *
 * 配置来源：
 *   ACS GuardProfile（扁平 allow/deny 模型）——guard-config.ts 在 agent 启动前
 *   将 GuardProfile 写入 .claude/guard-profile.json，本 hook 启动时加载。
 *   规则通过 deny list 中的模式判断是否激活：命中对应 deny 条目的规则才生效。
 *
 * 设计原则：
 *   - 不依赖 LLM 判断（结构控制不退化）
 *   - GuardProfile 是安全策略的唯一配置源
 *   - 未命中任何激活规则时放行
 */

const fs = require("fs");
const path = require("path");

/**
 * 从 .claude/guard-profile.json 加载 GuardProfile。
 * 文件由 guard-config.ts 的 writeGuardSettings() 写入。
 * 文件不存在或解析失败时返回 null（保守：所有规则生效）。
 */
function loadGuardProfile() {
  try {
    const profilePath = path.join(process.cwd(), ".claude", "guard-profile.json");
    const raw = fs.readFileSync(profilePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 检查 deny list 中是否存在覆盖指定 guardPattern 的条目。
 * 如果 GuardProfile 不可用，返回 true（保守：规则生效）。
 */
function isPatternDenied(profile, guardPattern) {
  if (!profile?.deny || !Array.isArray(profile.deny)) return true;
  const denyList = profile.deny.map((p) => String(p).toLowerCase());
  const pattern = (guardPattern ?? "").toLowerCase();
  if (!pattern) return false;
  return denyList.some((entry) => entry.includes(pattern));
}

/**
 * 所有可激活的安全规则。
 *
 * 每条规则包含：
 *   - domain:        归属领域（database/filesystem/git）
 *   - guardPattern:  对应 GuardProfile.{domain}.denyPatterns 中的条目；
 *                    规则仅在 denyPatterns 包含此条目时激活。
 *   - commandPattern:匹配命令的正则
 *   - check:         (可选) 额外的语义检查函数
 *   - denyMessage:   拒绝时返回的原因
 *
 * database 规则额外受 database.mode 控制：
 *   mode === "allow" → 整组跳过；mode === "deny" → 按 guardPattern 逐条判断。
 */
const RULES = [
  // ── 数据库直接操作 ──────────────────────────────────────
  {
    name: "database-write",
    domain: "database",
    guardPattern: null, // 不绑定具体 denyPattern，由 database.mode 整体控制
    commandPattern: /\b(sqlite3|psql|mysql|mongo|mongosh|redis-cli)\b/,
    check: (command) => {
      const writeOps = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|INDEX|DATABASE|SCHEMA)|ALTER\s+TABLE|CREATE\s+TABLE|PRAGMA\s+(?!table_info|index_list|table_xinfo|foreign_key_list|compile_options|database_list|function_list|module_list|page_count|page_size|quick_check|integrity_check))\b/i;
      return writeOps.test(command);
    },
    denyMessage: "数据库写操作被 GuardProfile 拒绝。只允许 SELECT、.schema、.dump、.tables 等只读操作。",
  },
  {
    name: "database-raw-cli",
    domain: "database",
    guardPattern: null,
    commandPattern: /\bsqlite3\s+\S+\.(db|sqlite|sqlite3)\b/,
    check: (command) => {
      const isReadOnly = /\b(SELECT\b|^\s*\.(schema|dump|tables|headers|indices|dbinfo|mode\s+ascii|mode\s+line|mode\s+list|separator|show|output\s+stdout)|PRAGMA\s+(table_info|index_list|table_xinfo|foreign_key_list|compile_options|database_list|function_list|module_list|page_count|page_size|quick_check|integrity_check))/im;
      if (isReadOnly.test(command)) return false;
      const hasExplicitCommand = /\.(schema|dump|tables|headers|indices|dbinfo|read|mode)/i;
      if (hasExplicitCommand.test(command)) return false;
      return true;
    },
    denyMessage: "sqlite3 直接访问数据库文件被 GuardProfile 拒绝。如只需查询，请使用 .schema、.dump、.tables 等只读命令。",
  },

  // ── 危险文件系统操作（由 filesystem.denyPatterns 控制） ──
  {
    name: "filesystem-rm-root",
    domain: "filesystem",
    guardPattern: "rm -rf /",
    commandPattern: /\brm\s+-rf\s+\//,
    denyMessage: "rm -rf / 被 GuardProfile 拒绝。",
  },
  {
    name: "filesystem-chmod-all",
    domain: "filesystem",
    guardPattern: "chmod 777",
    commandPattern: /\bchmod\s+777\b/,
    denyMessage: "chmod 777 被 GuardProfile 拒绝。",
  },
  {
    name: "filesystem-chmod-suid",
    domain: "filesystem",
    guardPattern: "chmod SUID/SGID",
    commandPattern: /\bchmod\s+[0-7]*[4-7]777\b/,
    denyMessage: "chmod 设置 SUID/SGID 位被 GuardProfile 拒绝。",
  },

  // ── 危险 Git 操作（由 git.denyPatterns 控制） ──────────
  {
    name: "git-force-push-main",
    domain: "git",
    guardPatterns: ["push --force main", "push --force master"],
    commandPattern: /\bgit\s+push\s+.*(--force|--force-with-lease|-f)\b/,
    check: (command) => /\b(main|master)\b/.test(command),
    denyMessage: "git push --force 到 main/master 被 GuardProfile 拒绝。",
  },
  {
    name: "git-reset-hard",
    domain: "git",
    guardPattern: "reset --hard",
    commandPattern: /\bgit\s+reset\s+--hard\b/,
    denyMessage: "git reset --hard 被 GuardProfile 拒绝。",
  },
  {
    name: "git-clean-force",
    domain: "git",
    guardPattern: "clean -fdx",
    commandPattern: /\bgit\s+clean\s+(-fdx|-f\s+-d\s+-x)\b/,
    denyMessage: "git clean -fdx 被 GuardProfile 拒绝。请使用 git clean -fd 或 git clean -fx。",
  },
];

/**
 * 判断规则是否应激活（扁平 deny 模型）。
 * 规则的 guardPattern 命中 deny list 中任一 entry 即激活。
 * - guardPatterns（数组）：任一条目命中即激活
 * - guardPattern（单条）：必须命中才激活
 * - guardPattern 为 null（database 规则）：deny list 中有数据库 CLI pattern 即激活
 */
function isRuleActive(rule, profile) {
  if (rule.domain === "database") {
    // 无 profile 或 deny 中无数据库 CLI pattern → 数据库规则激活（保守）
    if (!profile?.deny) return true;
    return profile.deny.some((entry) => /sqlite3|psql|mysql|mongo|mongosh|redis-cli/i.test(String(entry)));
  }
  if (rule.guardPatterns) {
    return rule.guardPatterns.some((p) => isPatternDenied(profile, p));
  }
  return isPatternDenied(profile, rule.guardPattern);
}

function main() {
  const profile = loadGuardProfile();

  let input = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let toolCall;
    try {
      toolCall = JSON.parse(input);
    } catch {
      output({ decision: "allow" });
      return;
    }

    if (toolCall.tool_name !== "Bash") {
      output({ decision: "allow" });
      return;
    }

    const command = toolCall.tool_input?.command ?? "";
    if (!command) {
      output({ decision: "allow" });
      return;
    }

    for (const rule of RULES) {
      if (!isRuleActive(rule, profile)) continue;
      if (!rule.commandPattern.test(command)) continue;

      if (rule.check) {
        if (rule.check(command)) {
          output({ decision: "deny", reason: rule.denyMessage });
          return;
        }
      } else {
        output({ decision: "deny", reason: rule.denyMessage });
        return;
      }
    }

    output({ decision: "allow" });
  });
}

function output(result) {
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}

main();
