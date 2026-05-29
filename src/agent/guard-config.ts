/**
 * Guard Config：ACS GuardProfile ↔ agent 原生配置翻译层
 *
 * 职责：
 *  1. 从 config/guard-profile.json 加载系统默认 GuardProfile（唯一配置源）
 *  2. 将 Project.guard_profile 解析为 GuardProfile（数组合并到系统默认之上）
 *  3. 将 GuardProfile（扁平 allow/deny 模型）翻译为各 agent 的原生配置格式并写入磁盘
 *
 * 配置来源：
 *  - Project.guard_profile（数据库字段，per-project 覆盖） > config/guard-profile.json
 *  - config/guard-profile.json 是仓库内置文件，缺失/解析失败即报错
 *
 * 设计原则：
 *  - ACS GuardProfile 使用 agent 原生工具模式（扁平 allow/deny），与 agent 能力一致
 *  - 翻译层不做安全决策——只负责格式化并写入 agent 原生配置文件
 *  - 所有 agent 配置文件统一使用读取-合并-写入策略，保留已有非托管字段
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../logger";
import type { GuardProfile } from "../agent/capability";

/**
 * 从 config/guard-profile.json 加载系统默认 GuardProfile（唯一配置源）。
 * 文件缺失/不可解析 → 直接抛错。
 * 字段级非法值 → 回退空数组 + 日志告警。
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

  const allow = Array.isArray(src["allow"])
    ? (src["allow"] as unknown[]).filter((e): e is string => typeof e === "string")
    : [];
  const deny = Array.isArray(src["deny"])
    ? (src["deny"] as unknown[]).filter((e): e is string => typeof e === "string")
    : [];

  if (!Array.isArray(src["allow"])) logger.warn("GuardProfile.allow 不是数组 → 回退空数组");
  if (!Array.isArray(src["deny"])) logger.warn("GuardProfile.deny 不是数组 → 回退空数组");

  return { allow, deny };
}

/** 系统默认 GuardProfile——从 config/guard-profile.json 加载 */
export const DEFAULT_GUARD_PROFILE: GuardProfile = loadGuardProfileConfig();

/**
 * 从 Project.guard_profile 解析 GuardProfile。
 * 如果 project 未设置 guard_profile，返回默认值。
 * project 的 allow/deny 追加到系统默认之上（不替换）。
 */
export function resolveGuardProfile(projectGuard: Record<string, unknown> | null | undefined): GuardProfile {
  if (!projectGuard) return DEFAULT_GUARD_PROFILE;

  const projectAllow = Array.isArray(projectGuard["allow"])
    ? (projectGuard["allow"] as unknown[]).filter((e): e is string => typeof e === "string")
    : [];
  const projectDeny = Array.isArray(projectGuard["deny"])
    ? (projectGuard["deny"] as unknown[]).filter((e): e is string => typeof e === "string")
    : [];

  return {
    allow: [...DEFAULT_GUARD_PROFILE.allow, ...projectAllow],
    deny: [...DEFAULT_GUARD_PROFILE.deny, ...projectDeny],
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
// 各 agent 的翻译函数
// ═══════════════════════════════════════════════════════════════════

/**
 * GuardProfile → Claude Code settings.local.json 的 permissions 段。
 *
 * Claude Code 实际能力边界（--permission-mode default，-p 非交互模式）：
 *  - deny list 中的工具 → Claude Code 直接拒绝，写入 result.permission_denials
 *  - allow list 中的工具 → Claude Code 直接放行，不经过任何检查
 *  - 都不命中 → Claude Code 自身启发式判断（安全命令自动放行，不产生 permission_denials）
 *
 * ACS 设计要求"非白名单操作必须审批"，但 Claude Code 协议不支持此模式：
 *  - Claude Code 没有实时权限交互（暂停→上报→等待→继续）
 *  - 非交互模式下对"不在任一列表"的命令自行判断，不产生 permission_denials
 *
 * 因此采用 denylist-only 策略：
 *  - 只传递 deny 列表到 Claude Code（黑名单拦截已知危险命令）
 *  - allow 列表留空，让 Claude Code 自身启发式放行安全命令
 *  - guard-bash.js PreToolUse hook 作为第二层防线（Bash 命令语义分析）
 *  - extraAllow 在 retry 场景下动态注入 allow 列表（用户已审批的工具）
 *
 * 这意味着 Claude Code agent 层只保证"黑名单拦截"，不保证"非白名单审批"。
 * 后续如果 Claude Code 支持更严格的权限模式（如 real-time permission prompt），
 * 可在此处切换翻译策略。
 */
export function translateToClaudeSettings(guard: GuardProfile): AgentPermissions {
  return {
    allow: [],
    deny: [...guard.deny],
  };
}

/**
 * GuardProfile → Codex config.toml 内容。
 * Codex 仅支持 filesystem 层级的 sandbox_mode；
 * 如果 deny 包含文件系统危险模式（rm -rf、chmod），使用 read-only sandbox。
 */
export function translateToCodexConfigToml(guard: GuardProfile): string {
  const hasRestrictiveFilesystem = guard.deny.some((p) =>
    p.includes("rm -rf") || p.includes("chmod 777") || p.includes("chmod SUID")
  );
  const sandbox = hasRestrictiveFilesystem ? "read-only" : "workspace-write";
  return [
    `# Codex 配置 — Snail Shell GuardProfile 翻译生成`,
    `# 通过 CODEX_HOME 环境变量指向此目录加载`,
    ``,
    `sandbox_mode = "${sandbox}"`,
    ``,
  ].join("\n");
}

// OpenCode 使用项目级 opencode.json，当前通过移除 --dangerously-skip-permissions
// 恢复默认权限模式实现安全控制。后续 OpenCode adapter 可直接将 GuardProfile 翻译
// 为 opencode.json。

// ═══════════════════════════════════════════════════════════════════
// 配置文件写入辅助函数
// ═══════════════════════════════════════════════════════════════════

/**
 * 从 PreToolUse 条目中过滤 guard-bash hook，保留其他 hooks。
 * 兼容旧格式（command 直接在 entry）和正确格式（command 在 hooks 数组内）。
 * 对于正确格式：只移除 inner hooks 中的 guard-bash hook，保留 entry 内其他非 Snail hooks；
 * 过滤后若 entry 的 hooks 数组变空则移除整个 entry。
 */
function filterGuardBashHooks(existingPreToolUse: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const entry of existingPreToolUse) {
    // 旧格式：command 直接在 entry 上 → 整条移除
    if (typeof entry.command === "string" && entry.command.includes("guard-bash.js")) {
      continue;
    }
    // 正确格式：从 hooks 数组中只移除 guard-bash hook，保留其他 hooks
    if (Array.isArray(entry.hooks)) {
      const filteredHooks = (entry.hooks as Array<Record<string, unknown>>).filter(
        (h) => !(typeof h.command === "string" && h.command.includes("guard-bash.js"))
      );
      // 过滤后仍有其他 hooks → 保留 entry（用过滤后的 hooks 替换）
      if (filteredHooks.length > 0) {
        result.push({ ...entry, hooks: filteredHooks });
      }
      // 过滤后为空 → 移除整个 entry
      continue;
    }
    // 无 guard-bash 的普通 entry → 保留
    result.push(entry);
  }
  return result;
}

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
 * 写入 .claude/settings.local.json（合并模式）和 .claude/guard-profile.json。
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
  /** Claude Code hooks 格式：{ matcher, hooks: [{ type, command }] } */
  const shellGuardHook = { matcher: "Bash", hooks: [{ type: "command", command: `node ${hookScriptPath}` }] };
  const existingHooks = (existing.hooks ?? {}) as Record<string, unknown>;
  const existingPreToolUse = Array.isArray(existingHooks["PreToolUse"])
    ? (existingHooks["PreToolUse"] as Array<Record<string, unknown>>)
    : [];
  const otherPreToolUse = filterGuardBashHooks(existingPreToolUse);

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
  if (sectionStart !== -1) {
    lines.splice(sectionStart, 0, newLine, "");
    return lines.join("\n");
  }
  return toml.trimEnd() + "\n" + newLine + "\n";
}

/**
 * GuardProfile → Codex 原生配置。
 */
export function writeCodexGuardConfig(guard: GuardProfile, projectRoot?: string): void {
  const codexDir = path.join(projectRoot ?? process.cwd(), ".codex");
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }
  const configPath = path.join(codexDir, "config.toml");
  const newSandboxLine = `sandbox_mode = "${guard.deny.some((p) => p.includes("rm -rf") || p.includes("chmod")) ? "read-only" : "workspace-write"}"`;

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
