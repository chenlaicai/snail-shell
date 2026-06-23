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

    return allPrompts.map(prompt => ({
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

  private parseDocument(raw: string, filename: string): PromptDocument {
    const title = filename.replace(/\.md$/, "");
    return { id: title, title, content: raw.trim(), tags: [], scope: Scope.Platform };
  }
}
