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
 * 每个 skill 子目录单独创建符号链接（而非整个目录的符号链接），
 * 以便支持项目级覆盖：全局 skill 和项目级 skill 各自创建链接，项目级同名覆盖全局。
 *
 * 脚本路径不受影响：skill 内引用 `node .meta/skills/<name>/scripts/...` 的路径
 * 指向实际文件位置，符号链接只改变访问入口，不改变文件系统中的实际位置。
 */
export function ensureSkillSymlinks(projectRoot: string, skills: SkillCapability[]): void {
  if (skills.length === 0) return;

  const linkDirs = [
    path.join(projectRoot, ".claude", "skills"),
    path.join(projectRoot, ".agents", "skills"),
  ];

  for (const linkDir of linkDirs) {
    ensureDir(linkDir);
    for (const skill of skills) {
      const linkPath = path.join(linkDir, skill.name);
      const targetPath = skill.directory;

      try {
        const existing = fs.readlinkSync(linkPath);
        if (existing === targetPath) continue;
        // 指向不同目标，更新
        fs.unlinkSync(linkPath);
      } catch {
        // 不是符号链接或不存在
        if (fs.existsSync(linkPath)) {
          // 是真实目录或文件，跳过（不覆盖用户手动创建的内容）
          logger.warn(`skill symlink target already exists (not a symlink), skipping: ${linkPath}`);
          continue;
        }
      }

      try {
        fs.symlinkSync(targetPath, linkPath);
      } catch (err) {
        logger.warn(`failed to create skill symlink ${linkPath} → ${targetPath}: ${err}`);
      }
    }
  }
}

/**
 * 清理 invokeMessage 创建的符号链接目录。
 *
 * 只删除本系统创建的符号链接，不删除用户手动创建的真实目录。
 */
export function cleanupSkillSymlinks(projectRoot: string): void {
  const linkDirs = [
    path.join(projectRoot, ".claude", "skills"),
    path.join(projectRoot, ".agents", "skills"),
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
