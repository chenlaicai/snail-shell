/**
 * Skill service implementation.
 *
 * Loads SKILL.md files from filesystem, parses frontmatter + markdown body.
 * Platform: .meta/skills/\*\/SKILL.md
 * Workspace: <workspace>/.snail/skills/\*\/SKILL.md
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SkillService } from '@/skill/api.js';
import type { SkillDefinition } from '@/skill/types.js';

export class SkillServiceImpl implements SkillService {
  private platformCache: SkillDefinition[] | null = null;

  constructor(
    private platformDir: string,
    private workspaceRoot?: string,
  ) {}

  listPlatform(): SkillDefinition[] {
    if (!this.platformCache) {
      this.platformCache = this.loadFromDir(this.platformDir, 'platform');
    }
    return this.platformCache;
  }

  listWorkspace(): SkillDefinition[] {
    if (!this.workspaceRoot) return [];
    const dir = path.join(this.workspaceRoot, '.snail', 'skills');
    return this.loadFromDir(dir, 'workspace');
  }

  listAll(): SkillDefinition[] {
    const platform = this.listPlatform();
    const workspace = this.listWorkspace();
    this.validateNoCollision(platform, workspace);
    return [...platform, ...workspace];
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.listAll().find(s => s.name === name);
  }

  // ─── internal ───

  private loadFromDir(dir: string, source: 'platform' | 'workspace'): SkillDefinition[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const skills: SkillDefinition[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const raw = fs.readFileSync(skillMdPath, 'utf-8');
      const skill = this.parseSkillDefinition(skillMdPath, entry.name, raw, source);
      skills.push(skill);
    }

    this.validateNoDuplicates(skills, source);
    return skills;
  }

  private parseSkillDefinition(
    filePath: string,
    dirName: string,
    raw: string,
    source: 'platform' | 'workspace',
  ): SkillDefinition {
    const { frontmatter, body } = this.splitFrontmatter(raw);
    const name = frontmatter.name ?? dirName;
    const description = frontmatter.description ?? '';
    const directory = path.dirname(filePath);

    return { name, description, filePath, directory, content: body, source };
  }

  private splitFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: raw };

    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key) frontmatter[key] = value;
    }

    return { frontmatter, body: match[2] };
  }

  private validateNoDuplicates(skills: SkillDefinition[], source: string): void {
    const seen = new Set<string>();
    for (const skill of skills) {
      if (seen.has(skill.name)) {
        throw new Error(`Duplicate skill name "${skill.name}" in ${source} skills`);
      }
      seen.add(skill.name);
    }
  }

  private validateNoCollision(platform: SkillDefinition[], workspace: SkillDefinition[]): void {
    const platformNames = new Set(platform.map(s => s.name));
    for (const skill of workspace) {
      if (platformNames.has(skill.name)) {
        throw new Error(`Skill name collision: "${skill.name}" exists in both platform and workspace`);
      }
    }
  }
}
