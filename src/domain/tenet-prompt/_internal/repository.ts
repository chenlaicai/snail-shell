import fs from "fs";
import path from "path";
import type { PromptDocument, PromptWhen } from "@domain/tenet-prompt/model";
import type { FileSystem } from "@infra/file-system";

/** TenetPrompt 持久层接口 */
export interface TenetPromptRepository {
  list(): PromptDocument[];
  findById(id: string): PromptDocument | undefined;
}

/** TenetPrompt 文件存储实现 */
export class FileTenetPromptRepository implements TenetPromptRepository {
  private cache = new Map<string, PromptDocument>();

  constructor(private fileSystem: FileSystem, repoRoot: string, workspacePaths: string[] = []) {
    const platformDir = path.join(repoRoot, ".meta", "prompts");
    this.loadDir(platformDir, "platform");
    for (const wsPath of workspacePaths) {
      this.loadDir(path.join(wsPath, ".meta", "prompts"), "workspace");
    }
  }

  list(): PromptDocument[] {
    return [...this.cache.values()].sort((a, b) => a.priority - b.priority);
  }

  findById(id: string): PromptDocument | undefined {
    return this.cache.get(id);
  }

  private loadDir(dir: string, layer: "platform" | "workspace"): void {
    if (!this.fileSystem.exists(dir)) return;

    const files = this.fileSystem.listDir(dir).filter(f => f.endsWith(".md"));
    for (const file of files) {
      const filePath = path.join(dir, file);
      const raw = this.fileSystem.readFile(filePath);
      if (!raw) continue;

      try {
        const doc = this.parseDocument(raw);
        this.cache.set(doc.id, { ...doc, layer });
      } catch (err) {
        console.warn(`Failed to parse prompt: ${filePath}`, err);
      }
    }
  }

  private parseDocument(raw: string): Omit<PromptDocument, "layer"> {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) throw new Error("Invalid prompt format: missing frontmatter");

    const [, frontmatter, content] = match;
    const meta = this.parseFrontmatter(frontmatter);

    if (!meta.id) throw new Error("Prompt frontmatter missing 'id'");
    if (!meta.title) throw new Error("Prompt frontmatter missing 'title'");

    return {
      id: meta.id,
      title: meta.title,
      stability: meta.stability ?? "static",
      priority: meta.priority ?? 100,
      when: meta.when ?? null,
      content: content.trim(),
    };
  }

  private parseFrontmatter(raw: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let currentKey = "";
    let currentObj: Record<string, unknown> = result;
    let inArray = false;
    let arrayKey = "";
    let arrayItems: string[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      if (inArray && !trimmed.startsWith("-")) {
        currentObj[arrayKey] = arrayItems;
        inArray = false;
        arrayItems = [];
      }

      if (inArray && trimmed.startsWith("-")) {
        arrayItems.push(trimmed.slice(1).trim().replace(/^["']|["']$/g, ""));
        continue;
      }

      const nestedMatch = trimmed.match(/^(\w+):\s*$/);
      if (nestedMatch) {
        currentKey = nestedMatch[1];
        currentObj = {};
        result[currentKey] = currentObj;
        continue;
      }

      const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
      if (kvMatch) {
        const [, key, value] = kvMatch;

        if (value === "") {
          inArray = true;
          arrayKey = key;
          arrayItems = [];
          continue;
        }

        if (value === "true") { currentObj[key] = true; continue; }
        if (value === "false") { currentObj[key] = false; continue; }
        if (/^\d+$/.test(value)) { currentObj[key] = parseInt(value); continue; }

        currentObj[key] = value.replace(/^["']|["']$/g, "");
      }
    }

    if (inArray) {
      currentObj[arrayKey] = arrayItems;
    }

    return result;
  }
}
