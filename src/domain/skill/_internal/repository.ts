import fs from "fs";
import path from "path";
import type { Workspace } from "@domain/workspace/model";
import type { Skill } from "@domain/skill/model";
import type { FileSystem } from "@infra/file-system";

/** Skill 持久层接口 */
export interface SkillRepository {
  list(): Skill[];
  findByWorkspace(workspace: Workspace): Skill[];
}

/** Skill 文件存储实现 */
export class FileSkillRepository implements SkillRepository {
  private platformSkills: Skill[] = [];
  private workspaceSkills = new Map<string, Skill[]>();  // workspace_path -> skills

  constructor(private fileSystem: FileSystem, repoRoot: string, workspacePaths: string[]) {
    this.loadPlatformSkills(repoRoot);
    this.loadWorkspaceSkills(workspacePaths);
  }

  list(): Skill[] {
    return [...this.platformSkills, ...this.workspaceSkills.values()].flat();
  }

  findByWorkspace(workspace: Workspace): Skill[] {
    const wsSkills = this.workspaceSkills.get(workspace.path) ?? [];
    return [...this.platformSkills, ...wsSkills];
  }

  private loadPlatformSkills(repoRoot: string): void {
    const platformDir = path.join(repoRoot, ".meta", "skills");
    this.platformSkills = this.loadSkillDir(platformDir, "platform");
  }

  private loadWorkspaceSkills(workspacePaths: string[]): void {
    for (const wsPath of workspacePaths) {
      const wsSkillDir = path.join(wsPath, ".snail", "skills");
      const skills = this.loadSkillDir(wsSkillDir, "workspace");
      this.workspaceSkills.set(wsPath, skills);
    }
  }

  private loadSkillDir(dir: string, source: "platform" | "workspace"): Skill[] {
    if (!this.fileSystem.exists(dir)) return [];

    const entries = this.fileSystem.listDirs(dir);
    const skills: Skill[] = [];

    for (const entry of entries) {
      const skillDir = path.join(dir, entry);
      const skillFile = path.join(skillDir, "SKILL.md");

      if (!this.fileSystem.exists(skillFile)) continue;

      const raw = this.fileSystem.readFile(skillFile);
      if (!raw) continue;

      try {
        const skill = this.parseSkill(raw, skillDir, source);
        skills.push(skill);
      } catch (err) {
        console.warn(`Failed to parse skill: ${skillFile}`, err);
      }
    }

    return skills;
  }

  private parseSkill(raw: string, dirPath: string, source: "platform" | "workspace"): Skill {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) throw new Error("Invalid skill format: missing frontmatter");

    const [, frontmatter, content] = match;
    const meta = this.parseFrontmatter(frontmatter);

    if (!meta.name) throw new Error("Skill frontmatter missing 'name'");

    return {
      name: meta.name,
      description: meta.description ?? "",
      content: content.trim(),
      source,
      dir_path: dirPath,
    };
  }

  private parseFrontmatter(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        result[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
    return result;
  }
}
