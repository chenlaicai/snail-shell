/**
 * Guard Config：ACP GuardProfile ↔ agent 原生配置翻译层
 *
 * 职责：
 *  1. 提供系统默认 GuardProfile
 *  2. 将 Project.guard_profile（JSON 数据）解析为 GuardProfile
 *  3. 将 GuardProfile 翻译为 agent 的原生配置格式
 *  4. 将翻译结果写入 agent 的原生配置文件
 *
 * 当前实现范围：
 *  - Claude Code：完整翻译链路（settings.local.json allow/deny + PreToolUse hook）
 *  - Codex/OpenCode：GuardProfile 翻译待后续实现；当前通过移除 bypass flag 恢复各自默认安全机制
 *
 * 设计原则：
 *  - Snail Shell 是策略定义者，不是运行时安全警察
 *  - 策略翻译为 agent 原生格式后，由 agent 自己的权限系统执行
 *  - 不同 agent 的支持粒度不同，做尽力而为的翻译
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
 * Claude Code 允许的 Bash 操作白名单（与 settings.local.json 对齐）。
 * 按工具名称匹配，参数级安全拦截由 PreToolUse hook 负责。
 */
const CLAUDE_ALLOW_LIST: string[] = [
  // 基础工具版本检查
  "Bash(npm --version)",
  "Bash(brew --version)",
  "Bash(pyenv --version)",
  "Bash(conda --version)",
  "Bash(asdf --version)",
  // npm/node 生态
  "Bash(npm init:*)",
  "Bash(npm install:*)",
  "Bash(npm test:*)",
  "Bash(npm run:*)",
  "Bash(npx tsc:*)",
  "Bash(npx tsx:*)",
  "Bash(npx eslint:*)",
  "Bash(node dist/test.js)",
  "Bash(node dist/integration-test.js)",
  "Bash(node:*)",
  // curl / 网络
  "Bash(curl:*)",
  "Bash(curl -s http://localhost:3000/api/sessions -X POST -H 'Content-Type: application/json' -d '{\"\"title\"\":\"\"test\"\"}')",
  // claude CLI 自调用
  "Bash(claude -p \"hello\" --output-format stream-json)",
  "Bash(claude -p \"hello\" --output-format stream-json --verbose)",
  "Bash(claude -p \"在 /tmp 下创建一个文件 test-snail.txt，内容为 hello\" --output-format stream-json --verbose)",
  "Bash(claude settings:*)",
  // codex / opencode
  "Bash(codex --help)",
  "Bash(codex exec:*)",
  "Bash(codex:*)",
  "Bash(opencode run:*)",
  // python
  "Bash(python:*)",
  "Bash(python3:*)",
  // 文件/系统工具
  "Bash(wc:*)",
  "Bash(wc -l src/agent/*.ts)",
  "Bash(find src/agent -name \"*.ts\" -exec wc -l {} +)",
  "Bash(grep:*)",
  "Bash(grep -E '\\\\.\\(ts|js|json\\)$')",
  "Bash(grep -o context_window[^}]* /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js)",
  "Bash(grep -o context_window_size[^,}]* /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js)",
  "Bash(grep -o [0-9][0-9][0-9][0-9][0-9][0-9] /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js)",
  "Bash(grep -o \"\"model[A-Za-z]*\"\" /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js)",
  "Bash(ls:*)",
  "Bash(ls -d src/*/)",
  "Bash(ls docs/features/20260515/F2026051501-*.md)",
  "Bash(cp -r src/web dist/web)",
  "Bash(env)",
  "Bash(printf:*)",
  "Bash(printf '\\\\nexit=%s\\\\n' $?)",
  // chmod（安全用途放行，危险参数由 hook 拦截）
  "Bash(chmod:*)",
  // git 操作（危险操作由 deny 列表 + hook 拦截）
  "Bash(git init:*)",
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(git remote:*)",
  "Bash(git worktree:*)",
  "Bash(git config:*)",
  "Bash(git filter-branch:*)",
  "Bash(git push:*)",
  "Bash(git branch:*)",
  "Bash(git checkout:*)",
  "Bash(git log:*)",
  "Bash(git switch:*)",
  "Bash(git fetch:*)",
  "Bash(git pull:*)",
  "Bash(git merge:*)",
  "Bash(git reset:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git:*)",
  // gh CLI
  "Bash(gh pr:*)",
  "Bash(gh run:*)",
  // Git HTTP/1.1 临时降级
  "Bash(GIT_HTTP_VERSION=HTTP/1.1 git push)",
  // Web 工具
  "WebSearch",
  "WebFetch(domain:docs.anthropic.com)",
  // 安全的文件删除（限定范围）
  "Bash(rm -rf dist/web)",
];

/**
 * 数据库 CLI 模式列表，用于 allow/deny 权限配置。
 * database.mode === "deny" → 加入 deny 列表
 * database.mode === "allow" → 加入 allow 列表
 */
const DATABASE_CLI_PATTERNS = [
  "Bash(sqlite3:*)", "Bash(psql:*)", "Bash(mysql:*)",
  "Bash(mongo:*)", "Bash(mongosh:*)", "Bash(redis-cli:*)",
];

/**
 * 将 GuardProfile 翻译为 Claude Code settings.local.json 内容。
 *
 * allow: 基础安全操作（npm/git/node/curl 等），从 CLAUDE_ALLOW_LIST 取。
 *        当 database.mode === "allow" 时，额外加入数据库 CLI 条目。
 * deny: database CLI（mode === "deny"）+ guardProfile.denyPatterns 转换
 * 参数级拦截由 PreToolUse hook guard-bash.js 负责
 */
export function translateToClaudeSettings(guard: GuardProfile): ClaudeSettings {
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

  // database.mode === "allow" 时，将数据库 CLI 加入 allow 列表，
  // 否则 Claude Code 原生权限层仍会拦截
  const allow = guard.database.mode === "allow"
    ? [...CLAUDE_ALLOW_LIST, ...DATABASE_CLI_PATTERNS]
    : CLAUDE_ALLOW_LIST;

  return { permissions: { allow, deny } };
}

/**
 * 将 GuardProfile 翻译为 Claude Code settings.local.json 并写入磁盘。
 * 同时写入 .claude/guard-profile.json 供 guard-bash.js PreToolUse hook 读取，
 * 使 hook 可以根据 database.mode 决定是否拦截数据库操作。
 *
 * 在 agent adapter spawn agent 进程前调用，确保 agent 以正确的权限配置启动。
 *
 * 写入路径为 process.cwd()/.claude/。
 * .claude/ 目录如不存在则自动创建。
 *
 * 合并策略：如果 settings.local.json 已存在，只覆盖 Snail Shell 管理的
 * permissions 段和 guard-bash PreToolUse hook；保留已有的其他 hooks、MCP 配置、
 * 模型设置等非 Snail Shell 管理的字段。
 */
export function writeGuardSettings(guard: GuardProfile): void {
  const settings = translateToClaudeSettings(guard);

  const claudeDir = path.join(process.cwd(), ".claude");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const settingsPath = path.join(claudeDir, "settings.local.json");

  // 读取现有 settings，保留 Snail Shell 不管理的配置段
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      // 解析失败时从头生成
    }
  }

  // Snail Shell 托管的 PreToolUse hook 条目
  const shellGuardHook = {
    matcher: "Bash",
    command: "node .meta/hooks/guard-bash.js",
  };

  // 合并 PreToolUse hooks：保留非 Snail Shell 管理的条目，添加/更新 Snail Shell 的
  const existingHooks = (existing.hooks ?? {}) as Record<string, unknown>;
  const existingPreToolUse = Array.isArray(existingHooks["PreToolUse"])
    ? (existingHooks["PreToolUse"] as Array<Record<string, unknown>>)
    : [];
  const otherPreToolUse = existingPreToolUse.filter(
    (entry) => entry.command !== "node .meta/hooks/guard-bash.js"
  );

  const merged: Record<string, unknown> = {
    ...existing,
    permissions: settings.permissions,
    hooks: {
      ...existingHooks,
      PreToolUse: [...otherPreToolUse, shellGuardHook],
    },
  };

  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");

  // 同时写入 GuardProfile 到 .claude/guard-profile.json，供 guard-bash.js hook 读取。
  // hook 根据 database.mode 决定是否拦截数据库操作：
  //   - database.mode === "deny"（默认）→ 拦截数据库写操作
  //   - database.mode === "allow" → 放行数据库操作
  // filesystem/git 的硬底线规则（rm -rf /、chmod 777、git push --force main 等）不受 mode 影响，始终生效。
  const guardProfilePath = path.join(claudeDir, "guard-profile.json");
  fs.writeFileSync(guardProfilePath, JSON.stringify(guard, null, 2) + "\n");
}
