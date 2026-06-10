import fs from "fs";
import path from "path";
import type { Workspace } from "@domain/workspace/model";
import type { PromptDocument } from "@domain/tenet-prompt/model";
import type { FileSystem } from "@infra/file-system";

/** TenetPrompt 持久层接口 */
export interface TenetPromptRepository {
  list(): PromptDocument[];
  findByWorkspace(workspace: Workspace, tags?: string[]): PromptDocument[];
}

/** TenetPrompt 文件存储实现 */
export class FileTenetPromptRepository implements TenetPromptRepository {
  private platformPrompts: PromptDocument[] = [];
  private workspacePrompts = new Map<string, PromptDocument[]>();  // workspace_path -> prompts

  constructor(private fileSystem: FileSystem, repoRoot: string, workspacePaths: string[]) {
    this.loadPlatformPrompts(repoRoot);
    this.loadWorkspacePrompts(workspacePaths);
  }

  list(): PromptDocument[] {
    return [...this.platformPrompts, ...this.workspacePrompts.values()].flat();
  }

  findByWorkspace(workspace: Workspace, tags?: string[]): PromptDocument[] {
    const wsPrompts = this.workspacePrompts.get(workspace.path) ?? [];
    const allPrompts = [...this.platformPrompts, ...wsPrompts];

    if (!tags || tags.length === 0) {
      // 无 tag 过滤，返回所有
      return allPrompts;
    }

    // 过滤：无 tag 的 + 命中 tag 的
    return allPrompts.filter(prompt => {
      if (prompt.tags.length === 0) return true;  // 无 tag，始终返回
      return prompt.tags.some(tag => tags.includes(tag));  // 命中 tag
    });
  }

  private loadPlatformPrompts(repoRoot: string): void {
    const platformDir = path.join(repoRoot, ".meta", "prompts");
    this.platformPrompts = this.loadPromptDir(platformDir, "platform");
  }

  private loadWorkspacePrompts(workspacePaths: string[]): void {
    for (const wsPath of workspacePaths) {
      const wsPromptDir = path.join(wsPath, ".meta", "prompts");
      const prompts = this.loadPromptDir(wsPromptDir, "workspace");
      this.workspacePrompts.set(wsPath, prompts);
    }
  }

  private loadPromptDir(dir: string, source: "platform" | "workspace"): PromptDocument[] {
    if (!this.fileSystem.exists(dir)) return [];

    const files = this.fileSystem.listDir(dir).filter(f => f.endsWith(".md"));
    const prompts: PromptDocument[] = [];

    for (const file of files) {
      const filePath = path.join(dir, file);
      const raw = this.fileSystem.readFile(filePath);
      if (!raw) continue;

      try {
        const doc = this.parseDocument(raw, source);
        prompts.push(doc);
      } catch (err) {
        console.warn(`Failed to parse prompt: ${filePath}`, err);
      }
    }

    return prompts;
  }

  private parseDocument(raw: string, source: "platform" | "workspace"): PromptDocument {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) throw new Error("Invalid prompt format: missing frontmatter");

    const [, frontmatter, content] = match;
    const meta = this.parseFrontmatter(frontmatter);

    if (!meta.title) throw new Error("Prompt frontmatter missing 'title'");

    return {
      id: meta.title,  // 用 title 作为 id
      title: meta.title,
      content: content.trim(),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      source,
    };
  }

  private parseFrontmatter(raw: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let inArray = false;
    let arrayKey = "";
    let arrayItems: string[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // 数组结束
      if (inArray && !trimmed.startsWith("-")) {
        result[arrayKey] = arrayItems;
        inArray = false;
        arrayItems = [];
      }

      // 数组项
      if (inArray && trimmed.startsWith("-")) {
        arrayItems.push(trimmed.slice(1).trim().replace(/^["']|["']$/g, ""));
        continue;
      }

      // key: value
      const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
      if (kvMatch) {
        const [, key, value] = kvMatch;

        // 数组开始
        if (value === "") {
          inArray = true;
          arrayKey = key;
          arrayItems = [];
          continue;
        }

        // 内联数组 [a, b, c]
        const inlineArrayMatch = value.match(/^\[(.*)\]$/);
        if (inlineArrayMatch) {
          result[key] = inlineArrayMatch[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
          continue;
        }

        // 字符串
        result[key] = value.replace(/^["']|["']$/g, "");
      }
    }

    // 处理末尾的数组
    if (inArray) {
      result[arrayKey] = arrayItems;
    }

    return result;
  }
}
