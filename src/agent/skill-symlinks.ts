import fs from "fs";
import path from "path";
import { logger } from "../logger";
import type { SkillCapability } from "./capability";

/**
 * 在 worktree 内创建符号链接目录，将 ACS skills 暴露为 agent 原生 skill 目录。
 *
 * 三个 agent CLI 的原生 skill 发现路径：
 *  - Claude Code: `.claude/skills/<name>/SKILL.md`
 *  - Codex:       `.agents/skills/<name>/SKILL.md`
 *  - OpenCode:    同时扫描 `.claude/skills/` 和 `.agents/skills/`
 *
 * 每个 skill 子目录单独创建符号链接（而非整个目录的符号链接）。
 * 全局 skill 和工作区级 skill 各自创建链接；同名 skill 在合并时已报错（skill name 全局唯一），
 * 因此符号链接层不会遇到同名冲突。
 *
 * 脚本路径不受影响：skill 内引用 `node .meta/skills/<name>/scripts/...` 的路径
 * 指向实际文件位置，符号链接只改变访问入口，不改变文件系统中的实际位置。
 */
export function ensureSkillSymlinks(workspaceRoot: string, skills: SkillCapability[]): void {
  if (skills.length === 0) return;

  const linkDirs = [
    path.join(workspaceRoot, ".claude", "skills"),
    path.join(workspaceRoot, ".agents", "skills"),
  ];

  for (const linkDir of linkDirs) {
    ensureDir(linkDir);
    for (const skill of skills) {
      ensureSingleSkillSymlink(linkDir, skill);
    }
  }
}

/**
 * 为单个 skill 创建符号链接。
 *
 * best-effort 并发策略：check-then-act 无锁保护。
 * 多个 agent 进程同时调用时可能产生竞态，但 try-catch 兜底确保不会崩溃。
 * 符号链接创建是幂等操作，最终状态一致即可，不需要严格互斥。
 *
 * 降级策略：skill 注入失败不阻塞 agent 启动。
 * agent 可以在无 skill 状态下运行（只是缺少 skill 能力），
 * 运维可通过 warn 日志排查问题。
 */
function ensureSingleSkillSymlink(linkDir: string, skill: SkillCapability): void {
  // 防止路径遍历攻击：skill.name 来自 SKILL.md frontmatter，是外部输入
  if (skill.name.includes('/') || skill.name.includes('\\') || skill.name.includes('..')) {
    logger.warn(`invalid skill name (contains path separator or traversal): ${skill.name}`);
    return;
  }

  const linkPath = path.join(linkDir, skill.name);
  const targetPath = skill.directory;

  try {
    const existing = fs.readlinkSync(linkPath);
    if (existing === targetPath) return;
    // 指向不同目标，更新
    fs.unlinkSync(linkPath);
  } catch {
    // 不是符号链接或不存在
    if (fs.existsSync(linkPath)) {
      // 是真实目录或文件，跳过（不覆盖用户手动创建的内容）
      logger.warn(`skill symlink target already exists (not a symlink), skipping: ${linkPath}`);
      return;
    }
  }

  try {
    fs.symlinkSync(targetPath, linkPath);
  } catch (err) {
    logger.warn(`failed to create skill symlink ${linkPath} → ${targetPath}: ${err}`);
  }
}

/**
 * 清理 invokeMessage 创建的符号链接目录。
 *
 * 只删除本系统创建的符号链接，不删除用户手动创建的真实目录。
 */
export function cleanupSkillSymlinks(workspaceRoot: string): void {
  const linkDirs = [
    path.join(workspaceRoot, ".claude", "skills"),
    path.join(workspaceRoot, ".agents", "skills"),
  ];
  for (const linkDir of linkDirs) {
    cleanupSingleDir(linkDir);
  }
}

function cleanupSingleDir(linkDir: string): void {
  try {
    if (!fs.existsSync(linkDir)) return;
    const entries = fs.readdirSync(linkDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      try { fs.unlinkSync(path.join(linkDir, entry.name)); } catch { /* best-effort */ }
    }
    removeIfEmpty(linkDir);
  } catch { /* directory doesn't exist, fine */ }
}

function removeIfEmpty(dir: string): void {
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
