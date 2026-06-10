import fs from "fs";
import path from "path";
import type { Skill } from "@domain/skill/model";
import type { FileSystem } from "@infra/file-system";

/** Skill 持久层接口 */
export interface SkillRepository {
  list(): Skill[];
  findByName(name: string): Skill | undefined;
}

/** Skill 文件存储实现 */
export class FileSkillRepository implements SkillRepository {
  private cache = new Map<string, Skill>();

  constructor(private fileSystem: FileSystem, repoRoot: string, workspacePaths: string[] = []) {
    const platformDir = path.join(repoRoot, ".meta", "skills");
    this.loadDir(platformDir, "platform");
    for (const wsPath of workspacePaths) {
      this.loadDir(path.join(wsPath, ".snail", "skills"), "workspace");
    }
  }

  list(): Skill[] {
    return [...this.cache.values()];
  }

  findByName(name: string): Skill | undefined {
    return this.cache.get(name);
  }

  private loadDir(dir: string, layer: "platform" | "workspace"): void {
    if (!this.fileSystem.exists(dir)) return;

    const entries = this.fileSystem.listDirs(dir);
    for (const entry of entries) {
      const skillFile = path.join(dir, entry, "SKILL.md");
      const raw = this.fileSystem.readFile(skillFile);
      if (!raw) continue;

      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) {
        console.warn(`Invalid skill format: ${skillFile}`);
        continue;
      }

      const [, frontmatter, content] = match;
      const meta = this.parseFrontmatter(frontmatter);

      if (!meta.name) {
        console.warn(`Skill missing name: ${skillFile}`);
        continue;
      }

      this.cache.set(meta.name, {
        name: meta.name,
        description: meta.description ?? "",
        layer,
        content: content.trim(),
      });
    }
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
