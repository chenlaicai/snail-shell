import path from "path";
import type { Workspace } from "@domain/workspace/model";
import { Scope } from "@domain/workspace/model";
import type { PromptDocument } from "@domain/tenet-prompt/model";
import type { FileDataStore } from "@infra/file-data-store";

/** TenetPrompt 持久层接口 */
export interface TenetPromptRepository {
  list(): PromptDocument[];
  findByWorkspace(workspace: Workspace, tags?: string[]): PromptDocument[];
}

/** TenetPrompt 文件存储实现 */
export class FileTenetPromptRepository implements TenetPromptRepository {
  private static readonly DIR = "prompts";

  private platformPrompts: PromptDocument[] = [];
  private workspacePrompts = new Map<string, PromptDocument[]>();

  constructor(platformStore: FileDataStore, workspaces: Workspace[]) {
    this.platformPrompts = this.loadPromptDir(platformStore, FileTenetPromptRepository.DIR);
    for (const ws of workspaces) {
      const wsStore = platformStore.workspace(ws.path);
      const prompts = this.loadPromptDir(wsStore, FileTenetPromptRepository.DIR)
        .map(p => ({ ...p, scope: Scope.Workspace, workspace: ws }));
      this.workspacePrompts.set(ws.path, prompts);
    }
  }

  list(): PromptDocument[] {
    return [...this.platformPrompts, ...this.workspacePrompts.values()].flat();
  }

  findByWorkspace(workspace: Workspace, tags?: string[]): PromptDocument[] {
    const wsPrompts = this.workspacePrompts.get(workspace.path) ?? [];
    const allPrompts = [...this.platformPrompts, ...wsPrompts];

    if (!tags || tags.length === 0) {
      return allPrompts;
    }

    return allPrompts.filter(prompt => {
      if (prompt.tags.length === 0) return true;
      return prompt.tags.some(tag => tags.includes(tag));
    });
  }

  private loadPromptDir(store: FileDataStore, relativeDir: string): PromptDocument[] {
    if (!store.exists(relativeDir)) return [];

    const files = store.listDir(relativeDir).filter(f => f.endsWith(".md"));
    const prompts: PromptDocument[] = [];

    for (const file of files) {
      const filePath = path.join(relativeDir, file);
      const raw = store.readFile(filePath);
      if (!raw) continue;

      try {
        const doc = this.parseDocument(raw);
        prompts.push(doc);
      } catch (err) {
        console.warn(`Failed to parse prompt: ${filePath}`, err);
      }
    }

    return prompts;
  }

  private parseDocument(raw: string): PromptDocument {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) throw new Error("Invalid prompt format: missing frontmatter");

    const [, frontmatter, content] = match;
    const meta = this.parseFrontmatter(frontmatter);

    if (typeof meta.title !== "string") throw new Error("Prompt frontmatter missing 'title'");

    return {
      id: meta.title,
      title: meta.title,
      content: content.trim(),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      scope: Scope.Platform,
    };
  }

  private parseFrontmatter(raw: string): Record<string, unknown> {
    const state = { result: {} as Record<string, unknown>, inArray: false, arrayKey: "", arrayItems: [] as string[] };

    for (const line of raw.split("\n")) {
      this.consumeFrontmatterLine(state, line);
    }

    this.flushFrontmatterArray(state);
    return state.result;
  }

  private consumeFrontmatterLine(state: { result: Record<string, unknown>; inArray: boolean; arrayKey: string; arrayItems: string[] }, line: string): void {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    if (state.inArray && !trimmed.startsWith("-")) {
      this.flushFrontmatterArray(state);
    }
    if (state.inArray && trimmed.startsWith("-")) {
      state.arrayItems.push(this.unquote(trimmed.slice(1).trim()));
      return;
    }

    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (!kvMatch) return;
    this.consumeFrontmatterKeyValue(state, kvMatch[1], kvMatch[2]);
  }

  private consumeFrontmatterKeyValue(state: { result: Record<string, unknown>; inArray: boolean; arrayKey: string; arrayItems: string[] }, key: string, value: string): void {
    if (value === "") {
      state.inArray = true;
      state.arrayKey = key;
      state.arrayItems = [];
      return;
    }

    const inlineArrayMatch = value.match(/^\[(.*)\]$/);
    state.result[key] = inlineArrayMatch
      ? inlineArrayMatch[1].split(",").map(s => this.unquote(s.trim()))
      : this.unquote(value);
  }

  private flushFrontmatterArray(state: { result: Record<string, unknown>; inArray: boolean; arrayKey: string; arrayItems: string[] }): void {
    if (!state.inArray) return;
    state.result[state.arrayKey] = state.arrayItems;
    state.inArray = false;
    state.arrayItems = [];
  }

  private unquote(value: string): string {
    return value.replace(/^["']|["']$/g, "");
  }
}
