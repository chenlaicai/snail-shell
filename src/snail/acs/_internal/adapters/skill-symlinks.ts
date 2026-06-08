/**
 * Skill 符号链接注入：将 ACS skills 暴露为 Claude Code 原生 skill 目录。
 *
 * Claude Code 发现路径：.claude/skills/<name>/SKILL.md
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SkillCapability } from '../../types.js';

/**
 * 确保 .claude/skills/ 下有指向各 skill 目录的符号链接。
 */
export function ensureSkillSymlinks(workspaceRoot: string, skills: SkillCapability[]): void {
  if (skills.length === 0) return;

  const linkDir = path.join(workspaceRoot, '.claude', 'skills');
  if (!fs.existsSync(linkDir)) {
    fs.mkdirSync(linkDir, { recursive: true });
  }

  for (const skill of skills) {
    ensureSingleSymlink(linkDir, skill);
  }
}

function ensureSingleSymlink(linkDir: string, skill: SkillCapability): void {
  // 防止路径遍历
  if (skill.name.includes('/') || skill.name.includes('\\') || skill.name.includes('..')) {
    return;
  }

  const linkPath = path.join(linkDir, skill.name);
  const targetPath = skill.directory;

  try {
    const existing = fs.readlinkSync(linkPath);
    if (existing === targetPath) return;
    fs.unlinkSync(linkPath);
  } catch {
    if (fs.existsSync(linkPath)) return; // 真实目录，不覆盖
  }

  try {
    fs.symlinkSync(targetPath, linkPath);
  } catch {
    // best-effort，不阻塞 agent 启动
  }
}
