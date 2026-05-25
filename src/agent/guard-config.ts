/**
 * Guard Config：ACP GuardProfile ↔ agent 原生配置翻译层
 *
 * 职责：
 *  1. 提供系统默认 GuardProfile（安全策略配置源）
 *  2. 将 Project.guard_profile 解析为 GuardProfile
 *  3. 将 GuardProfile 翻译为各 agent 的原生配置格式并写入磁盘
 *
 * 设计原则：
 *  - GuardProfile 是 Snail Shell 安全策略的唯一配置源
 *  - 翻译层不做安全决策——只负责格式化并写入 agent 原生配置文件
 *  - CLAUDE_BASE_OPERATIONS / CODEX_BASE_OPERATIONS / OPENCODE_BASE_OPERATIONS
 *    是 agent 运行所需的最低运维基线，不是安全策略；安全边界由 GuardProfile 定义
 */

import * as fs from "fs";
import * as path from "path";
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
    denyPatterns: ["chmod 777", "rm -rf /", "chmod SUID/SGID"],
  },
  network: {
    mode: "allow",
    allowedDomains: [],
  },
  git: {
    mode: "allow",
    denyPatterns: ["push --force main", "push --force master", "reset --hard", "clean -fdx"],
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

// ═══════════════════════════════════════════════════════════════════
// 通用类型
// ═══════════════════════════════════════════════════════════════════

export interface AgentPermissions {
  allow: string[];
  deny: string[];
}

// ═══════════════════════════════════════════════════════════════════
// 运维基线：各 agent 运行所需的最低操作（不是安全策略）
// ═══════════════════════════════════════════════════════════════════

/**
 * Claude Code 运维基线——agent 运行所需的最低 Bash 操作白名单。
 * 不包含安全策略；安全边界由 GuardProfile 派生的 allow/deny 列表控制。
 */
const CLAUDE_BASE_OPERATIONS: string[] = [
  "Bash(npm --version)", "Bash(brew --version)", "Bash(pyenv --version)",
  "Bash(conda --version)", "Bash(asdf --version)",
  "Bash(npm init:*)", "Bash(npm install:*)", "Bash(npm test:*)", "Bash(npm run:*)",
  "Bash(npx tsc:*)", "Bash(npx tsx:*)", "Bash(npx eslint:*)",
  "Bash(node dist/test.js)", "Bash(node dist/integration-test.js)", "Bash(node:*)",
  "Bash(curl:*)",
  "Bash(claude -p \"hello\" --output-format stream-json)",
  "Bash(claude -p \"hello\" --output-format stream-json --verbose)",
  "Bash(claude settings:*)",
  "Bash(codex --help)", "Bash(codex exec:*)", "Bash(codex:*)",
  "Bash(opencode run:*)",
  "Bash(python:*)", "Bash(python3:*)",
  "Bash(wc:*)", "Bash(find:*)", "Bash(grep:*)", "Bash(ls:*)",
  "Bash(cp:*)", "Bash(env)", "Bash(printf:*)",
  "Bash(chmod:*)",
  "Bash(git init:*)", "Bash(git add:*)", "Bash(git commit:*)",
  "Bash(git remote:*)", "Bash(git worktree:*)", "Bash(git config:*)",
  "Bash(git filter-branch:*)", "Bash(git push:*)", "Bash(git branch:*)",
  "Bash(git checkout:*)", "Bash(git log:*)", "Bash(git switch:*)",
  "Bash(git fetch:*)", "Bash(git pull:*)", "Bash(git merge:*)",
  "Bash(git reset:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git:*)",
  "Bash(gh pr:*)", "Bash(gh run:*)",
  "WebSearch", "WebFetch(domain:docs.anthropic.com)",
  "Bash(rm -rf dist/web)",
];

/**
 * Codex 运维基线。
 * 注：Codex 使用 sandbox 机制控制安全（read-only / workspace-write），非 allow/deny 列表模式。
 * 此常量保留供未来 Codex 支持 allow/deny 列表时使用。
 */

// ═══════════════════════════════════════════════════════════════════
// 安全策略条目（从 GuardProfile 派生）
// ═══════════════════════════════════════════════════════════════════

/** 数据库 CLI 工具的模式列表 */
const DATABASE_CLI_PATTERNS = [
  "Bash(sqlite3:*)", "Bash(psql:*)", "Bash(mysql:*)",
  "Bash(mongo:*)", "Bash(mongosh:*)", "Bash(redis-cli:*)",
];

/**
 * 从 GuardProfile 构建 deny 列表。
 * - database: mode === "deny" → deny 数据库 CLI
 * - filesystem: denyPatterns → deny 对应 Bash 模式
 * - git: denyPatterns → deny 对应 Bash 模式
 */
function buildDenyList(guard: GuardProfile): string[] {
  const deny: string[] = [];

  if (guard.database.mode === "deny") {
    deny.push(...DATABASE_CLI_PATTERNS);
  }

  for (const pattern of guard.filesystem.denyPatterns ?? []) {
    deny.push(`Bash(${pattern}:*)`);
  }

  for (const pattern of guard.git.denyPatterns ?? []) {
    deny.push(`Bash(${pattern}:*)`);
  }

  return deny;
}

/**
 * 从 GuardProfile 构建额外 allow 列表（在运维基线之上的安全策略授权）。
 * - database: mode === "allow" → allow 数据库 CLI
 */
function buildExtraAllowList(guard: GuardProfile): string[] {
  const extra: string[] = [];
  if (guard.database.mode === "allow") {
    extra.push(...DATABASE_CLI_PATTERNS);
  }
  return extra;
}

// ═══════════════════════════════════════════════════════════════════
// 各 agent 的翻译函数
// ═══════════════════════════════════════════════════════════════════

/**
 * GuardProfile → Claude Code settings.local.json 的 permissions 段。
 */
export function translateToClaudeSettings(guard: GuardProfile): AgentPermissions {
  return {
    allow: [...CLAUDE_BASE_OPERATIONS, ...buildExtraAllowList(guard)],
    deny: buildDenyList(guard),
  };
}

/**
 * GuardProfile → Codex config.toml 内容。
 *
 * Codex 原生配置机制：
 *  - 配置文件: $CODEX_HOME/config.toml（TOML 格式）
 *  - 通过设置 CODEX_HOME 环境变量指向 worktree 的 .codex/ 目录实现 per-project 配置
 *  - --sandbox 控制沙箱策略: read-only / workspace-write / danger-full-access
 *
 * Snail Shell 策略映射：
 *  - filesystem.mode="deny" → sandbox = "read-only"
 *  - filesystem.mode="allow" → sandbox = "workspace-write"（默认）
 */
export function translateToCodexConfigToml(guard: GuardProfile): string {
  const sandbox = guard.filesystem.mode === "deny" ? "read-only" : "workspace-write";
  return [
    `# Codex 配置 — Snail Shell GuardProfile 翻译生成`,
    `# 通过 CODEX_HOME 环境变量指向此目录加载`,
    ``,
    `sandbox_mode = "${sandbox}"`,
    ``,
  ].join("\n");
}

// OpenCode 使用全局配置 ~/.config/opencode/opencode.jsonc，不支持 per-project 配置。
// 当前通过移除 --dangerously-skip-permissions 恢复默认权限模式实现安全控制。
// 后续 OpenCode 支持 per-project 配置时，可在此补充翻译逻辑。

// ═══════════════════════════════════════════════════════════════════
// 配置文件写入
// ═══════════════════════════════════════════════════════════════════

/**
 * 将 GuardProfile 写入 .claude/guard-profile.json。
 * 供 guard-bash.js PreToolUse hook 读取安全策略。
 */
function writeGuardProfileJson(claudeDir: string, guard: GuardProfile): void {
  const guardProfilePath = path.join(claudeDir, "guard-profile.json");
  fs.writeFileSync(guardProfilePath, JSON.stringify(guard, null, 2) + "\n");
}

/**
 * GuardProfile → Claude Code 原生配置。
 *
 * 写入 .claude/settings.local.json（合并模式）和 .claude/guard-profile.json。
 * 在 Claude Code adapter spawn agent 前调用。
 */
export function writeClaudeGuardSettings(guard: GuardProfile): void {
  const claudeDir = path.join(process.cwd(), ".claude");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const settingsPath = path.join(claudeDir, "settings.local.json");
  const permissions = translateToClaudeSettings(guard);

  // 读取现有 settings，保留 Snail Shell 不管理的配置段
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      // 解析失败时从头生成
    }
  }

  // 合并 PreToolUse hooks：保留非 Snail Shell 管理的条目
  const shellGuardHook = { matcher: "Bash", command: "node .meta/hooks/guard-bash.js" };
  const existingHooks = (existing.hooks ?? {}) as Record<string, unknown>;
  const existingPreToolUse = Array.isArray(existingHooks["PreToolUse"])
    ? (existingHooks["PreToolUse"] as Array<Record<string, unknown>>)
    : [];
  const otherPreToolUse = existingPreToolUse.filter(
    (entry) => entry.command !== "node .meta/hooks/guard-bash.js"
  );

  const merged: Record<string, unknown> = {
    ...existing,
    permissions: permissions,
    hooks: {
      ...existingHooks,
      PreToolUse: [...otherPreToolUse, shellGuardHook],
    },
  };

  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  writeGuardProfileJson(claudeDir, guard);
}

/**
 * GuardProfile → Codex 原生配置。
 *
 * 写入 .codex/config.toml（TOML 格式），通过 CODEX_HOME 环境变量指向此目录加载。
 * Codex adapter 需要在 spawn 时设置 CODEX_HOME=process.cwd()/.codex。
 * 在 Codex adapter spawn agent 前调用。
 */
export function writeCodexGuardConfig(guard: GuardProfile): void {
  const codexDir = path.join(process.cwd(), ".codex");
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }
  const configPath = path.join(codexDir, "config.toml");
  fs.writeFileSync(configPath, translateToCodexConfigToml(guard), "utf-8");
}

// OpenCode: 无 per-project 配置入口（全局配置为 ~/.config/opencode/opencode.jsonc）。
// 安全机制：移除 --dangerously-skip-permissions 恢复默认权限模式（已在 opencode.ts 中完成）。

// ═══════════════════════════════════════════════════════════════════
// 向后兼容别名
// ═══════════════════════════════════════════════════════════════════

/** @deprecated 使用 writeClaudeGuardSettings */
export const writeGuardSettings = writeClaudeGuardSettings;
