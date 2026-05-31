/**
 * Guard Config：ACS GuardProfile ↔ agent 原生配置翻译层
 *
 * 职责：
 *  1. 从 config/guard-profile.json 加载系统默认 GuardProfile（唯一配置源）
 *  2. 将 Workspace.guard_profile 解析为 GuardProfile（数组合并到系统默认之上）
 *  3. 将 GuardProfile（扁平 allow/deny 模型）翻译为各 agent 的原生配置格式并写入磁盘
 *
 * 配置来源：
 *  - Workspace.guard_profile（数据库字段，per-workspace 覆盖） > config/guard-profile.json
 *  - config/guard-profile.json 是仓库内置文件，缺失/解析失败即报错
 *
 * 设计原则：
 *  - ACS GuardProfile 使用 agent 原生工具模式（扁平 allow/deny），与 agent 能力一致
 *  - 翻译层不做安全决策——只负责格式化并写入 agent 原生配置文件
 *  - 所有 agent 配置文件统一使用读取-合并-写入策略，保留已有非托管字段
 */

import * as fs from "fs";
import * as os from "os";
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
 * 从 Workspace.guard_profile 解析 GuardProfile。
 * 如果 workspace 未设置 guard_profile，返回默认值。
 * workspace 的 allow/deny 追加到系统默认之上（不替换）。
 */
export function resolveGuardProfile(workspaceGuard: Record<string, unknown> | null | undefined): GuardProfile {
  if (!workspaceGuard) return DEFAULT_GUARD_PROFILE;

  const workspaceAllow = Array.isArray(workspaceGuard["allow"])
    ? (workspaceGuard["allow"] as unknown[]).filter((e): e is string => typeof e === "string")
    : [];
  const workspaceDeny = Array.isArray(workspaceGuard["deny"])
    ? (workspaceGuard["deny"] as unknown[]).filter((e): e is string => typeof e === "string")
    : [];

  return {
    allow: [...DEFAULT_GUARD_PROFILE.allow, ...workspaceAllow],
    deny: [...DEFAULT_GUARD_PROFILE.deny, ...workspaceDeny],
  };
}

// ═══════════════════════════════════════════════════════════════════
// Claude Code 翻译：bypassPermissions + --disallowedTools
// ═══════════════════════════════════════════════════════════════════

/**
 * GuardProfile → Claude Code --disallowedTools CLI 参数。
 *
 * 将 guard.deny 列表转换为 Claude Code CLI 的 --disallowedTools 参数。
 * bypassPermissions 模式下，Claude Code 跳过自身启发式和 settings.local.json 权限评估，
 * 但 --disallowedTools 仍在 CLI 层面独立执行黑名单拦截。
 *
 * 已验证的行为：
 *  - 命中 disallowedTools 的命令 → 100% 被拦截（permission_denials）
 *  - 不命中的命令 → 100% 被放行（bypassPermissions 跳过启发式）
 */
export function buildDisallowedToolsArgs(guard: GuardProfile): string[] {
  if (guard.deny.length === 0) return [];
  return ["--disallowedTools", ...guard.deny];
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

/**
 * GuardProfile → OpenCode permission 配置。
 *
 * OpenCode 权限格式（opencode.jsonc）：
 * ```json
 * {
 *   "permission": {
 *     "*": "allow",
 *     "bash": {
 *       "*": "allow",
 *       "sqlite3 *": "deny"
 *     },
 *     "question": "deny"
 *   }
 * }
 * ```
 *
 * 翻译规则：
 *  - 默认 allow-all（与 Claude Code 策略一致）
 *  - deny 列表中的 Bash 命令 → bash 子规则 deny
 *  - deny 列表中的工具名称（如 AskUserQuestion）→ 对应 permission key deny
 *  - OpenCode 工具名映射：AskUserQuestion → question, EnterPlanMode/ExitPlanMode → 无对应（忽略）
 *
 * 能力缺口 — external_directory 权限：
 *  - OpenCode 内置 external_directory 权限（文件系统级），默认 action: "ask"
 *  - Snail Shell 的 worktree 路径（.claude/worktrees/xxx）在 projectRoot 内部，理论上应被允许
 *  - 但 OpenCode 的 external_directory 判断逻辑可能因 symlink 解析等原因误拒
 *  - 非交互模式（opencode run --format json）下，ask 动作自动被拒绝
 *  - ACS GuardProfile 没有目录级权限概念，翻译层不擅自决定 allow/deny
 *  - 当前行为：保持 OpenCode 默认 "ask"，如遇访问被拒需用户手动配置
 */
export function translateToOpenCodePermission(guard: GuardProfile): Record<string, unknown> {
  const bashDenyPatterns: string[] = [];
  const toolDenies: Record<string, string> = {};

  for (const entry of guard.deny) {
    // 解析 Bash(command pattern) 格式
    const bashMatch = entry.match(/^Bash\((.+)\)$/);
    if (bashMatch) {
      const cmd = bashMatch[1];
      // 将 ACS 模式转换为 OpenCode 通配符模式
      // ACS 使用 ":" 作为命令和参数的分隔符，OpenCode 直接拼接通配符
      // ACS: "sqlite3:*" → OpenCode: "sqlite3*"（无空格）
      // ACS: "rm -rf /:*" → OpenCode: "rm -rf /*"
      // ACS: "chmod 777:*" → OpenCode: "chmod 777*"
      // ACS: "push --force main:*" → OpenCode: "push --force main*"
      //
      // 转换逻辑：
      //  - ":*" 结尾 → 替换为 "*"（通配符，无空格）
      //  - ":" 结尾 → 替换为空字符串（移除分隔符）
      // 注意：不能用空格替换冒号，因为 "rm -rf /:*" 需要变成 "rm -rf /*" 而不是 "rm -rf / *"
      const opencodePattern = cmd.replace(/:\*$/, "*").replace(/:$/, "");
      bashDenyPatterns.push(opencodePattern);
      continue;
    }

    // 工具名称映射
    switch (entry) {
      case "AskUserQuestion":
        toolDenies["question"] = "deny";
        break;
      case "EnterPlanMode":
      case "ExitPlanMode":
        // OpenCode 无对应工具，忽略
        break;
      default:
        // 其他工具名称直接作为 permission key
        // OpenCode 工具名规范为小写（如 bash、question、file），因此使用 toLowerCase() 转换
        toolDenies[entry.toLowerCase()] = "deny";
    }
  }

  // 构建 permission 配置
  const permission: Record<string, unknown> = {
    "*": "allow",
  };

  // bash 子规则：默认 allow，deny 列表中的命令设为 deny
  if (bashDenyPatterns.length > 0) {
    const bashRules: Record<string, string> = {
      "*": "allow",
    };
    for (const pattern of bashDenyPatterns) {
      bashRules[pattern] = "deny";
    }
    permission["bash"] = bashRules;
  }

  // 合并工具级 deny
  Object.assign(permission, toolDenies);

  return permission;
}

/**
 * GuardProfile → OpenCode 全局配置。
 * 写入 ~/.config/opencode/opencode.jsonc（合并模式）。
 *
 * OpenCode 不支持 per-project 配置覆盖，只支持全局配置。
 * 安全机制：移除 --dangerously-skip-permissions 恢复默认权限模式（已在 opencode.ts 中完成）。
 *
 * 已知限制：全局配置覆盖
 * OpenCode 使用全局配置文件，当多个项目同时运行时，后写入的配置会覆盖先写入的配置。
 * 这是 OpenCode 架构的固有限制，无法在不支持 per-project 配置的情况下完全解决。
 *
 * 当前缓解措施：
 * 1. 每次 invokeMessage 调用时重新写入配置，确保当前项目的安全策略生效
 * 2. 配置写入是同步的，在 OpenCode 进程启动前完成
 *
 * 未来改进方向：
 * - 如果 OpenCode 支持 per-project 配置，可在此处切换翻译策略
 * - 或者在 OpenCode 启动参数中指定配置文件路径
 */
export function writeOpenCodeGuardConfig(guard: GuardProfile): void {
  /** 使用 os.homedir() 而非 process.env.HOME：HOME 未设置时回退值 "~" 是字面字符串，path.join 不会展开波浪号 */
  const configDir = path.join(os.homedir(), ".config", "opencode");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const configPath = path.join(configDir, "opencode.jsonc");
  const permission = translateToOpenCodePermission(guard);

  // 读取现有配置，保留 Snail Shell 不管理的配置段
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      // JSONC 解析：使用简单状态机移除注释，避免误伤 URL 中的 "//"
      const raw = fs.readFileSync(configPath, "utf-8");
      const cleaned = removeJsonComments(raw);
      existing = JSON.parse(cleaned);
    } catch {
      // 解析失败时从头生成
    }
  }

  // 合并 permission 配置（保留其他配置如 provider、model 等）
  const merged: Record<string, unknown> = {
    ...existing,
    $schema: "https://opencode.ai/config.json",
    permission,
  };

  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n");
}

/**
 * 移除 JSONC 中的注释（// 和 /* * /）和尾随逗号。
 * 使用状态机避免误伤字符串内的 "//" 或 "/*"。
 *
 * JSONC 允许尾随逗号（如 `[1, 2, 3,]`），但标准 JSON 不允许。
 * 移除注释后，需要进一步清理尾随逗号以确保输出是合法 JSON。
 */
function removeJsonComments(jsonc: string): string {
  const tokens: string[] = [];
  let pos = 0;

  while (pos < jsonc.length) {
    const { token, nextPos } = nextToken(jsonc, pos);
    tokens.push(token);
    pos = nextPos;
  }

  // 移除尾随逗号：逗号后只有空白和 ] 或 } 时，移除该逗号
  let result = tokens.join("");
  result = result.replace(/,(\s*[}\]])/g, "$1");
  return result;
}

/** 读取下一个 token（字符或注释） */
function nextToken(jsonc: string, pos: number): { token: string; nextPos: number } {
  const ch = jsonc[pos];

  // 字符串：原样复制到结束引号
  if (ch === '"') {
    return readString(jsonc, pos);
  }

  // // 注释：跳过到行尾
  if (ch === "/" && jsonc[pos + 1] === "/") {
    const lineEnd = jsonc.indexOf("\n", pos);
    return { token: "", nextPos: lineEnd === -1 ? jsonc.length : lineEnd };
  }

  // /* */ 注释：跳过到 */
  if (ch === "/" && jsonc[pos + 1] === "*") {
    const commentEnd = jsonc.indexOf("*/", pos + 2);
    return { token: "", nextPos: commentEnd === -1 ? jsonc.length : commentEnd + 2 };
  }

  // 普通字符
  return { token: ch, nextPos: pos + 1 };
}

/** 读取字符串 token（处理转义） */
function readString(jsonc: string, pos: number): { token: string; nextPos: number } {
  const chars: string[] = ['"'];
  let i = pos + 1;

  while (i < jsonc.length) {
    const ch = jsonc[i];
    chars.push(ch);

    if (ch === "\\") {
      // 转义字符：复制下一个字符
      i++;
      if (i < jsonc.length) {
        chars.push(jsonc[i]);
      }
    } else if (ch === '"') {
      // 字符串结束
      return { token: chars.join(""), nextPos: i + 1 };
    }

    i++;
  }

  // 未闭合的字符串
  return { token: chars.join(""), nextPos: i };
}

// ═══════════════════════════════════════════════════════════════════
// 配置文件写入
// ═══════════════════════════════════════════════════════════════════

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
export function writeCodexGuardConfig(guard: GuardProfile, workspaceRoot?: string): void {
  const codexDir = path.join(workspaceRoot ?? process.cwd(), ".codex");
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

// OpenCode: 无 per-workspace 配置入口（全局配置为 ~/.config/opencode/opencode.jsonc）。
// 安全机制：移除 --dangerously-skip-permissions 恢复默认权限模式（已在 opencode.ts 中完成）。
