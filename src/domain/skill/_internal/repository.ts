import path from "path";
import type { Workspace } from "@domain/workspace/model";
import { Scope } from "@domain/workspace/model";
import type { Skill } from "@domain/skill/model";
import type { FileDataStore } from "@infra/file-data-store";

/** Skill 持久层接口 */
export interface SkillRepository {
  list(): Skill[];
  findByWorkspace(workspace: Workspace): Skill[];
}

/** Skill 文件存储实现 */
export class FileSkillRepository implements SkillRepository {
  private static readonly DIR = "skills";

  private platformSkills: Skill[] = [];
  private workspaceSkills = new Map<string, Skill[]>();

  constructor(platformStore: FileDataStore, workspaces: Workspace[]) {
    this.platformSkills = this.loadSkillDir(platformStore, FileSkillRepository.DIR);
    for (const workspace of workspaces) {
      const workspaceStore = platformStore.workspace(workspace.path);
      const skills = this.loadSkillDir(workspaceStore, FileSkillRepository.DIR)
        .map(s => ({ ...s, scope: Scope.Workspace, workspace }));
      this.workspaceSkills.set(workspace.path, skills);
    }
  }

  list(): Skill[] {
    return [...this.platformSkills, ...this.workspaceSkills.values()].flat();
  }

  findByWorkspace(workspace: Workspace): Skill[] {
    const workspaceSkills = this.workspaceSkills.get(workspace.path) ?? [];
    return [...this.platformSkills, ...workspaceSkills];
  }

  private loadSkillDir(store: FileDataStore, relativeDir: string): Skill[] {
    if (!store.exists(relativeDir)) return [];

    const entries = store.listDirs(relativeDir);
    const skills: Skill[] = [];

    for (const entry of entries) {
      const skillDirPath = path.join(relativeDir, entry);
      const skillFilePath = path.join(skillDirPath, "SKILL.md");

      if (!store.exists(skillFilePath)) continue;

      const raw = store.readFile(skillFilePath);
      if (!raw) continue;

      try {
        const skill = this.parseSkill(raw, skillDirPath);
        skills.push(skill);
      } catch (err) {
        console.warn(`Failed to parse skill: ${skillFilePath}`, err);
      }
    }

    return skills;
  }

  private parseSkill(raw: string, dirPath: string): Skill {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) throw new Error("Invalid skill format: missing frontmatter");

    const [, frontmatter, content] = match;
    const meta = this.parseFrontmatter(frontmatter);

    if (!meta.name) throw new Error("Skill frontmatter missing 'name'");

    return {
      name: meta.name,
      description: meta.description ?? "",
      content: content.trim(),
      scope: Scope.Platform,
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
