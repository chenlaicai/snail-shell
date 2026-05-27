/**
 * Guard Config：ACS GuardProfile ↔ agent 原生配置翻译层
 *
 * 职责：
 *  1. 从 config/guard-profile.json 加载系统默认 GuardProfile（唯一配置源）
 *  2. 将 Project.guard_profile 解析为 GuardProfile（字段级合并到系统默认之上）
 *  3. 将 GuardProfile 翻译为各 agent 的原生配置格式并写入磁盘
 *
 * 配置来源：
 *  - Project.guard_profile（数据库字段，per-project 覆盖） > config/guard-profile.json
 *  - config/guard-profile.json 是仓库内置文件，缺失/解析失败即报错
 *
 * 设计原则：
 *  - 翻译层不做安全决策——只负责格式化并写入 agent 原生配置文件
 *  - 所有 agent 配置文件统一使用读取-合并-写入策略，保留已有非托管字段
 *  - 所有安全策略（domain denyPatterns + tool allow list）由 GuardProfile 统一承载
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../logger";
import type { GuardProfile, GuardDomain, GuardMode } from "../agent/capability";

/**
 * 字段级 schema 填补偿——配置文件部分字段缺失/非法时的合理底线值。
 * 不是"另一个完整配置"，不替代 config/guard-profile.json。
 * 只有单个字段在处理非法输入时引用这里的默认值。
 */
const SCHEMA_DEFAULTS: Record<string, GuardDomain> = {
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
  network: { mode: "allow", allowedDomains: [] },
  git: {
    mode: "allow",
    denyPatterns: ["push --force main", "push --force master", "reset --hard", "clean -fdx"],
  },
};

/**
 * 记录字段级回退日志。
 * override 包含非法值时告警具体字段名和回退到的默认值。
 */
function logFieldFallback(domain: string, override: unknown): void {
  const warnings: string[] = [];
  const defaults = SCHEMA_DEFAULTS[domain];

  if (!override || typeof override !== "object") {
    warnings.push(`${domain} 整体不是对象，全部字段回退默认值`);
  } else {
    const src = override as Record<string, unknown>;
    if (typeof src["mode"] !== "string" || !["allow", "deny", "ask"].includes(src["mode"] as string)) {
      warnings.push(`mode="${src["mode"]}" 无效 → 回退 "${defaults.mode}"`);
    }
    for (const key of ["readOnlyPatterns", "denyPatterns", "allowedDomains", "protectedPaths"]) {
      const val = src[key];
      if (val !== undefined && !Array.isArray(val)) {
        warnings.push(`${key} 不是数组 → 回退默认值`);
      }
    }
  }
  if (warnings.length > 0) {
    logger.warn(`GuardProfile.${domain}: ${warnings.join("; ")}`);
  }
}

/**
 * 从 config/guard-profile.json 加载系统默认 GuardProfile（唯一配置源）。
 * 文件缺失/不可解析 → 直接抛错。
 * 字段级非法值 → 回退到 SCHEMA_DEFAULTS + 日志告警。
 */
function loadGuardProfileConfig(): GuardProfile {
  const configPath = path.join(process.cwd(), "config", "guard-profile.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err: any) {
    throw new Error(`无法加载 config/guard-profile.json: ${err.message}`, { cause: err });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("config/guard-profile.json 内容不是有效的 JSON 对象");
  }
  const src = parsed as Record<string, unknown>;

  const result: GuardProfile = {} as GuardProfile;
  for (const domain of ["database", "filesystem", "network", "git"] as const) {
    const merged = mergeGuardDomain(SCHEMA_DEFAULTS[domain], src[domain]);
    logFieldFallback(domain, src[domain]);
    result[domain] = merged;
  }
  result.allowTools = Array.isArray(src["allowTools"])
    ? (src["allowTools"] as unknown[]).filter((e): e is string => typeof e === "string")
    : [];
  if (!Array.isArray(src["allowTools"])) {
    logger.warn("GuardProfile.allowTools 不是数组 → 回退空数组");
  }
  return result;
}

/** 系统默认 GuardProfile——从 config/guard-profile.json 加载 */
export const DEFAULT_GUARD_PROFILE: GuardProfile = loadGuardProfileConfig();

/**
 * 从 Project.guard_profile 解析 GuardProfile。
 * 如果 project 未设置 guard_profile 或格式不完整，返回默认值。
 */
export function resolveGuardProfile(projectGuard: Record<string, unknown> | null | undefined): GuardProfile {
  if (!projectGuard) return DEFAULT_GUARD_PROFILE;

  const projectAllowTools = Array.isArray(projectGuard["allowTools"])
    ? (projectGuard["allowTools"] as unknown[]).filter((e): e is string => typeof e === "string")
    : [];

  return {
    database: mergeGuardDomain(DEFAULT_GUARD_PROFILE.database, projectGuard["database"]),
    filesystem: mergeGuardDomain(DEFAULT_GUARD_PROFILE.filesystem, projectGuard["filesystem"]),
    network: mergeGuardDomain(DEFAULT_GUARD_PROFILE.network, projectGuard["network"]),
    git: mergeGuardDomain(DEFAULT_GUARD_PROFILE.git, projectGuard["git"]),
    allowTools: [...DEFAULT_GUARD_PROFILE.allowTools, ...projectAllowTools],
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
export function buildDenyList(guard: GuardProfile): string[] {
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
    allow: [...(guard.allowTools ?? []), ...buildExtraAllowList(guard)],
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
 * 写入 .claude/guard-profile.json（合并模式）。
 * 供 guard-bash.js PreToolUse hook 读取安全策略。
 */
function writeGuardProfileJson(claudeDir: string, guard: GuardProfile): void {
  const guardProfilePath = path.join(claudeDir, "guard-profile.json");
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(guardProfilePath)) {
    try { existing = JSON.parse(fs.readFileSync(guardProfilePath, "utf-8")); } catch { /* 重新生成 */ }
  }
  fs.writeFileSync(guardProfilePath, JSON.stringify({ ...existing, ...guard }, null, 2) + "\n");
}

/**
 * GuardProfile → Claude Code 原生配置。
 *
 * 写入 .claude/settings.local.json（合并模式）和 .claude/guard-profile.json。
 * 在 Claude Code adapter spawn agent 前调用。
 */
export function writeClaudeGuardSettings(guard: GuardProfile, projectRoot?: string, extraAllow?: string[]): void {
  const claudeDir = path.join(projectRoot ?? process.cwd(), ".claude");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const settingsPath = path.join(claudeDir, "settings.local.json");
  const permissions = translateToClaudeSettings(guard);

  /** retry 场景：临时追加审批通过的工具到 allow list */
  if (extraAllow && extraAllow.length > 0) {
    permissions.allow = [...permissions.allow, ...extraAllow];
  }

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
  const hookScriptPath = path.resolve(process.cwd(), ".meta", "hooks", "guard-bash.js");
  const shellGuardHook = { matcher: "Bash", command: `node ${hookScriptPath}` };
  const existingHooks = (existing.hooks ?? {}) as Record<string, unknown>;
  const existingPreToolUse = Array.isArray(existingHooks["PreToolUse"])
    ? (existingHooks["PreToolUse"] as Array<Record<string, unknown>>)
    : [];
  const otherPreToolUse = existingPreToolUse.filter(
    (entry) => !(typeof entry.command === "string" && entry.command.includes("guard-bash.js"))
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
 * 在 TOML 文本的顶层区域（第一个 [section] 之前）替换或追加 key。
 * section 内的同名 key 不受影响。
 */
function mergeTomlTopLevelKey(toml: string, key: string, newLine: string): string {
  const lines = toml.split("\n");
  const sectionStart = lines.findIndex((l) => /^\s*\[/.test(l));
  const topEnd = sectionStart === -1 ? lines.length : sectionStart;

  const keyRe = new RegExp(`^${key}\\s*=.+$`);
  const idx = lines.slice(0, topEnd).findIndex((l) => keyRe.test(l));

  if (idx !== -1) {
    lines[idx] = newLine;
    return lines.join("\n");
  }
  // 未在顶层找到 → 插入到第一个 [section] 之前（而非追加到文件末尾）
  if (sectionStart !== -1) {
    lines.splice(sectionStart, 0, newLine, "");
    return lines.join("\n");
  }
  return toml.trimEnd() + "\n" + newLine + "\n";
}

/**
 * GuardProfile → Codex 原生配置。
 *
 * 写入 .codex/config.toml（合并模式），通过 CODEX_HOME 加载。
 * Codex adapter spawn 时设置 CODEX_HOME=process.cwd()/.codex。
 */
export function writeCodexGuardConfig(guard: GuardProfile, projectRoot?: string): void {
  const codexDir = path.join(projectRoot ?? process.cwd(), ".codex");
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }
  const configPath = path.join(codexDir, "config.toml");
  const newSandboxLine = `sandbox_mode = "${guard.filesystem.mode === "deny" ? "read-only" : "workspace-write"}"`;

  let content: string;
  if (fs.existsSync(configPath)) {
    const existing = fs.readFileSync(configPath, "utf-8");
    content = mergeTomlTopLevelKey(existing, "sandbox_mode", newSandboxLine);
  } else {
    content = [
      `# Codex 配置 — Snail Shell GuardProfile 翻译生成`,
      `# 通过 CODEX_HOME 环境变量指向此目录加载`,
      ``,
      newSandboxLine,
      ``,
    ].join("\n");
  }
  fs.writeFileSync(configPath, content, "utf-8");
}

// OpenCode: 无 per-project 配置入口（全局配置为 ~/.config/opencode/opencode.jsonc）。
// 安全机制：移除 --dangerously-skip-permissions 恢复默认权限模式（已在 opencode.ts 中完成）。

// ═══════════════════════════════════════════════════════════════════
// 向后兼容别名
// ═══════════════════════════════════════════════════════════════════

/** @deprecated 使用 writeClaudeGuardSettings */
export const writeGuardSettings = writeClaudeGuardSettings;
