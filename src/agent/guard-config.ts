/**
 * Guard Config：ACP GuardProfile ↔ agent 原生配置翻译层
 *
 * 职责：
 *  1. 提供系统默认 GuardProfile
 *  2. 将 Project.guard_profile（JSON 数据）解析为 GuardProfile
 *  3. 将 GuardProfile 翻译为各 agent 的原生配置格式
 *
 * 设计原则：
 *  - Snail Shell 是策略定义者，不是运行时安全警察
 *  - 策略翻译为 agent 原生格式后，由 agent 自己的权限系统执行
 *  - 不同 agent 的支持粒度不同，做尽力而为的翻译
 */

import type { GuardProfile, GuardDomain, GuardMode } from "../agent/capability";

/** 系统默认 GuardProfile——最严格但合理的默认策略 */
export const DEFAULT_GUARD_PROFILE: GuardProfile = {
  database: {
    mode: "deny",
    readOnlyPatterns: ["SELECT", ".schema", ".dump", ".tables", ".headers", ".indices", ".dbinfo"],
    denyPatterns: ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE TABLE", "PRAGMA"],
  },
  filesystem: {
    mode: "allow",
    protectedPaths: ["/etc", "~/.ssh", "~/.aws", "~/.gnupg", "~/.config"],
    denyPatterns: ["chmod 777", "rm -rf /"],
  },
  network: {
    mode: "allow",
    allowedDomains: [],
  },
  git: {
    mode: "allow",
    denyPatterns: ["push --force main", "push --force master", "reset --hard"],
  },
};

/**
 * 从 Project.guard_profile 解析 GuardProfile。
 * 如果 project 未设置 guard_profile 或格式不完整，返回默认值。
 */
export function resolveGuardProfile(projectGuard: Record<string, unknown> | null | undefined): GuardProfile {
  if (!projectGuard) return DEFAULT_GUARD_PROFILE;

  return {
    database: mergeGuardDomain(DEFAULT_GUARD_PROFILE.database, projectGuard["database"]),
    filesystem: mergeGuardDomain(DEFAULT_GUARD_PROFILE.filesystem, projectGuard["filesystem"]),
    network: mergeGuardDomain(DEFAULT_GUARD_PROFILE.network, projectGuard["network"]),
    git: mergeGuardDomain(DEFAULT_GUARD_PROFILE.git, projectGuard["git"]),
  };
}

function mergeGuardDomain(defaultDomain: GuardDomain, override: unknown): GuardDomain {
  if (!override || typeof override !== "object") return defaultDomain;
  const o = override as Record<string, unknown>;
  return {
    mode: (typeof o["mode"] === "string" && ["allow", "deny", "ask"].includes(o["mode"] as string)
      ? o["mode"] : defaultDomain.mode) as GuardMode,
    readOnlyPatterns: Array.isArray(o["readOnlyPatterns"])
      ? o["readOnlyPatterns"].filter((p): p is string => typeof p === "string")
      : defaultDomain.readOnlyPatterns,
    denyPatterns: Array.isArray(o["denyPatterns"])
      ? o["denyPatterns"].filter((p): p is string => typeof p === "string")
      : defaultDomain.denyPatterns,
    allowedDomains: Array.isArray(o["allowedDomains"])
      ? o["allowedDomains"].filter((d): d is string => typeof d === "string")
      : defaultDomain.allowedDomains,
    protectedPaths: Array.isArray(o["protectedPaths"])
      ? o["protectedPaths"].filter((p): p is string => typeof p === "string")
      : defaultDomain.protectedPaths,
  };
}

/** Claude Code settings.json 格式 */
export interface ClaudeSettings {
  permissions: {
    allow: string[];
    deny: string[];
  };
}

/**
 * 将 GuardProfile 翻译为 Claude Code settings.local.json 内容。
 *
 * 翻译规则：
 *  - database: deny → sqlite3/psql/mysql 加入 deny；readOnlyPatterns 只放行 SELECT/.schema 等
 *    但当前 Claude Code settings 的 allow/deny 是基于工具名称匹配而非参数匹配，
 *    所以参数级拦截由 PreToolUse hook 负责。此处只做工具级 deny。
 *  - git: deny 的 pattern 加入 deny 列表
 *  - filesystem: deny 的 pattern 加入 deny 列表
 */
export function translateToClaudeSettings(guard: GuardProfile): ClaudeSettings {
  const allow: string[] = [
    // 基础文件操作由 Claude Code acceptEdits 模式自动处理
    // 这里放行已知安全的 Bash 操作
    "Bash(git status:*)",
    "Bash(git log:*)",
    "Bash(git diff:*)",
    "Bash(git add:*)",
    "Bash(git commit:*)",
    "Bash(git branch:*)",
    "Bash(git checkout:*)",
    "Bash(git switch:*)",
    "Bash(git fetch:*)",
    "Bash(git pull:*)",
    "Bash(git remote:*)",
    "Bash(git worktree:*)",
    "Bash(npm:*)",
    "Bash(npx:*)",
    "Bash(node:*)",
    "Bash(curl:*)",
    "Bash(wc:*)",
    "Bash(find:*)",
    "Bash(grep:*)",
    "Bash(ls:*)",
    "Bash(cat:*)",
    "Bash(cp:*)",
    "Bash(env)",
    "Bash(python:*)",
    "Bash(python3:*)",
    "Bash(printf:*)",
    "WebSearch",
  ];

  const deny: string[] = [];

  // database: deny → 工具级拒绝
  if (guard.database.mode === "deny") {
    deny.push("Bash(sqlite3:*)", "Bash(psql:*)", "Bash(mysql:*)", "Bash(mongo:*)");
  }

  // filesystem: deny patterns
  for (const pattern of guard.filesystem.denyPatterns ?? []) {
    deny.push(`Bash(${pattern}:*)`);
  }

  // git: deny patterns
  for (const pattern of guard.git.denyPatterns ?? []) {
    deny.push(`Bash(${pattern}:*)`);
  }

  return { permissions: { allow, deny } };
}
