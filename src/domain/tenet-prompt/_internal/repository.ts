import path from "path";
import type { Workspace } from "@domain/workspace/model";
import { Scope } from "@domain/workspace/model";
import type { PromptDocument } from "@domain/tenet-prompt/model";
import type { FileDataStore } from "@infra/file-data-store";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "tenet-prompt" });

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
    for (const workspace of workspaces) {
      const workspaceStore = platformStore.workspace(workspace.path);
      const prompts = this.loadPromptDir(workspaceStore, FileTenetPromptRepository.DIR)
        .map(p => ({ ...p, scope: Scope.Workspace, workspace }));
      this.workspacePrompts.set(workspace.path, prompts);
    }
  }

  list(): PromptDocument[] {
    return [...this.platformPrompts, ...this.workspacePrompts.values()].flat();
  }

  findByWorkspace(workspace: Workspace, tags?: string[]): PromptDocument[] {
    const workspacePrompts = this.workspacePrompts.get(workspace.path) ?? [];
    const allPrompts = [...this.platformPrompts, ...workspacePrompts];

    if (!tags || tags.length === 0) {
      return allPrompts;
    }

    // 文件级 tags 兼容旧逻辑
    const fileMatched = allPrompts.filter(prompt => {
      if (prompt.tags.length === 0) return true;
      return prompt.tags.some(tag => tags.includes(tag));
    });

    // 规则级 tags 过滤：每条规则行首可带 [tag,tag] 标记
    return fileMatched.map(prompt => ({
      ...prompt,
      content: this.filterContentByTags(prompt.content, tags),
    }));
  }

  /**
   * 规则级 tag 过滤。
   * - 无 [tag] 前缀的行始终保留（通用规则）
   * - XML section 标签行始终保留
   * - 带 [tag] 的行仅在 tag 匹配时保留
   */
  private filterContentByTags(content: string, tags: string[]): string {
    return content.split("\n").filter(line => {
      const tagMatch = line.match(/^\[([^\]]+)\]\s/);
      if (!tagMatch) return true;
      const ruleTags = tagMatch[1].split(",").map(t => t.trim());
      return ruleTags.some(t => tags.includes(t));
    }).join("\n");
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
        const doc = this.parseDocument(raw, file);
        prompts.push(doc);
      } catch (err) {
        log.warn({ err, filePath }, "Failed to parse prompt");
      }
    }

    return prompts;
  }

  private parseDocument(raw: string, filename?: string): PromptDocument {
    // 支持两种格式：有 frontmatter（旧）和无 frontmatter（新）
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (match) {
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

    // 无 frontmatter：从文件名提取 id/title，全文为 content
    const title = filename ? filename.replace(/\.md$/, "") : "untitled";
    return { id: title, title, content: raw.trim(), tags: [], scope: Scope.Platform };
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
