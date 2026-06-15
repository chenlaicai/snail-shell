import fs from "fs";
import path from "path";
import type { SkillCapability } from "../../model";

/**
 * 在 worktree 内创建符号链接目录，将 ACS skills 暴露为 agent 原生 skill 目录。
 *
 * 三个 agent CLI 的原生 skill 发现路径：
 *  - Claude Code: `.claude/skills/<name>/SKILL.md`
 *  - Codex:       `.agents/skills/<name>/SKILL.md`
 *  - OpenCode:    同时扫描 `.claude/skills/` 和 `.agents/skills/`
 */
export function ensureSkillSymlinks(workspacePath: string, skills: SkillCapability[]): void {
  if (skills.length === 0) return;

  const linkDirs = [
    path.join(workspacePath, ".claude", "skills"),
    path.join(workspacePath, ".agents", "skills"),
  ];

  for (const linkDir of linkDirs) {
    ensureDir(linkDir);
    for (const skill of skills) {
      ensureSingleSkillSymlink(linkDir, skill);
    }
  }
}

function ensureSingleSkillSymlink(linkDir: string, skill: SkillCapability): void {
  // 防止路径遍历攻击：skill.name 来自 SKILL.md frontmatter，是外部输入
  if (skill.name.includes('/') || skill.name.includes('\\') || skill.name.includes('..')) {
    console.warn(`[acs] invalid skill name (contains path separator or traversal): ${skill.name}`);
    return;
  }

  const linkPath = path.join(linkDir, skill.name);
  const targetPath = skill.directory;

  try {
    const existing = fs.readlinkSync(linkPath);
    if (existing === targetPath) return;
    fs.unlinkSync(linkPath);
  } catch {
    if (fs.existsSync(linkPath)) {
      console.warn(`[acs] skill symlink target already exists (not a symlink), skipping: ${linkPath}`);
      return;
    }
  }

  try {
    fs.symlinkSync(targetPath, linkPath);
  } catch (err) {
    console.warn(`[acs] failed to create skill symlink ${linkPath} → ${targetPath}: ${err}`);
  }
}

/**
 * 清理 invokeMessage 创建的符号链接目录。
 */
export function cleanupSkillSymlinks(workspacePath: string): void {
  const linkDirs = [
    path.join(workspacePath, ".claude", "skills"),
    path.join(workspacePath, ".agents", "skills"),
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
