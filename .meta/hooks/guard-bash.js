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
 * 守护策略（由 ACP GuardProfile 翻译而来）：
 *   - database: 拒绝 sqlite3/psql/mysql 等数据库 CLI 的写操作
 *   - filesystem: 拒绝 rm -rf /、chmod 777 等危险文件操作
 *   - git: 拒绝 push --force main/master、reset --hard 等危险 git 操作
 *
 * 设计原则：
 *   - 不依赖 LLM 判断（结构控制不退化）
 *   - 命中 deny 规则时直接拒绝，不做启发式猜测
 *   - 未命中任何规则时放行
 */

const DANGEROUS_PATTERNS = [
  // ── 数据库直接操作 ──────────────────────────────────────
  {
    name: "database-write",
    // 匹配 sqlite3/psql/mysql/mongo 等数据库 CLI
    commandPattern: /\b(sqlite3|psql|mysql|mongo|mongosh|redis-cli)\b/,
    // 检测写操作：INSERT/UPDATE/DELETE/DROP/ALTER/CREATE TABLE/非只读 PRAGMA
    check: (command) => {
      const writeOps = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|INDEX|DATABASE|SCHEMA)|ALTER\s+TABLE|CREATE\s+TABLE|PRAGMA\s+(?!table_info|index_list|table_xinfo|foreign_key_list|compile_options|database_list|function_list|module_list|page_count|page_size|quick_check|integrity_check))\b/i;
      return writeOps.test(command);
    },
    denyMessage: "数据库写操作被 GuardProfile 拒绝。只允许 SELECT、.schema、.dump、.tables 等只读操作。",
  },
  {
    name: "database-raw-cli",
    // 匹配 sqlite3 不带写操作但也不是只读命令的直接数据库文件访问
    // 注意：只读命令（SELECT, .schema 等）放行；其他情况拒绝
    commandPattern: /\bsqlite3\s+\S+\.(db|sqlite|sqlite3)\b/,
    check: (command) => {
      // 如果是只读操作，放行
      const isReadOnly = /\b(SELECT\b|^\s*\.(schema|dump|tables|headers|indices|dbinfo|mode\s+ascii|mode\s+line|mode\s+list|separator|show|output\s+stdout)|PRAGMA\s+(table_info|index_list|table_xinfo|foreign_key_list|compile_options|database_list|function_list|module_list|page_count|page_size|quick_check|integrity_check))/im;
      if (isReadOnly.test(command)) return false;

      // sqlite3 直接连接数据库文件但没有明确的只读命令 → 可能执行任意 SQL
      const hasExplicitCommand = /\.(schema|dump|tables|headers|indices|dbinfo|read|mode)/i;
      if (hasExplicitCommand.test(command)) return false;

      // 没有明确只读命令，可能是交互式或包含未检测到的危险命令
      return true;
    },
    denyMessage: "sqlite3 直接访问数据库文件被 GuardProfile 拒绝。如只需查询，请使用 .schema、.dump、.tables 等只读命令。",
  },

  // ── 危险文件系统操作 ────────────────────────────────────
  {
    name: "filesystem-rm-root",
    commandPattern: /\brm\s+-rf\s+\//,
    denyMessage: "rm -rf / 被 GuardProfile 拒绝。",
  },
  {
    name: "filesystem-chmod-all",
    commandPattern: /\bchmod\s+777\b/,
    denyMessage: "chmod 777 被 GuardProfile 拒绝。",
  },
  {
    name: "filesystem-chmod-suid",
    commandPattern: /\bchmod\s+[0-7]*[4-7]777\b/,
    denyMessage: "chmod 设置 SUID/SGID 位被 GuardProfile 拒绝。",
  },

  // ── 危险 Git 操作 ───────────────────────────────────────
  {
    name: "git-force-push-main",
    commandPattern: /\bgit\s+push\s+.*(--force|--force-with-lease|-f)\b/,
    check: (command) => /\b(main|master)\b/.test(command),
    denyMessage: "git push --force 到 main/master 被 GuardProfile 拒绝。",
  },
  {
    name: "git-reset-hard",
    commandPattern: /\bgit\s+reset\s+--hard\b/,
    denyMessage: "git reset --hard 被 GuardProfile 拒绝。",
  },
  {
    name: "git-clean-force",
    commandPattern: /\bgit\s+clean\s+(-fdx|-f\s+-d\s+-x)\b/,
    denyMessage: "git clean -fdx 被 GuardProfile 拒绝。请使用 git clean -fd 或 git clean -fx。",
  },
];

function main() {
  let input = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let toolCall;
    try {
      toolCall = JSON.parse(input);
    } catch {
      // 无法解析输入，保守放行
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

    for (const rule of DANGEROUS_PATTERNS) {
      if (!rule.commandPattern.test(command)) continue;

      if (rule.check) {
        if (rule.check(command)) {
          output({ decision: "deny", reason: rule.denyMessage });
          return;
        }
      } else {
        // 无 check 函数的规则，命中 pattern 即拒绝
        output({ decision: "deny", reason: rule.denyMessage });
        return;
      }
    }

    // 未命中任何危险规则，放行
    output({ decision: "allow" });
  });
}

function output(result) {
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}

main();
