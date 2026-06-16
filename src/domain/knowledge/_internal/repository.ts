import type { Workspace } from "@domain/workspace/model";
import { Scope } from "@domain/workspace/model";
import type { KnowledgeEntry, CreateKnowledgeInput, RemoveKnowledgeInput } from "@domain/knowledge/model";
import type { FileDataStore } from "@infra/file-data-store";

/** Knowledge 持久层接口 */
export interface KnowledgeRepository {
  list(): KnowledgeEntry[];
  findByWorkspace(workspace: Workspace): KnowledgeEntry[];
  add(input: CreateKnowledgeInput): KnowledgeEntry;
  remove(input: RemoveKnowledgeInput): void;
}

/**
 * Knowledge 文件存储实现。
 *
 * 每个条目一个 md 文件，scope 由文件所在目录决定。
 * 文件名格式：{id}#{title}.md
 * 容错：文件名不符合时，以 frontmatter 为准，更新文件名。
 */
export class FileKnowledgeRepository implements KnowledgeRepository {
  private static readonly DIR = "knowledge";

  private platformEntries: KnowledgeEntry[] = [];
  private workspaceEntries = new Map<string, KnowledgeEntry[]>();

  constructor(private dataStore: FileDataStore, workspaces: Workspace[]) {
    this.loadPlatformEntries();
    this.loadWorkspaceEntries(workspaces);
  }

  list(): KnowledgeEntry[] {
    return [...this.platformEntries, ...this.workspaceEntries.values()].flat();
  }

  findByWorkspace(workspace: Workspace): KnowledgeEntry[] {
    const workspaceEntries = this.workspaceEntries.get(workspace.path) ?? [];
    return [...this.platformEntries, ...workspaceEntries];
  }

  add(input: CreateKnowledgeInput): KnowledgeEntry {
    const entry: KnowledgeEntry = {
      id: input.id,
      title: input.title,
      tags: input.tags ?? [],
      content: input.content,
      scope: input.scope,
      workspace: input.workspace,
    };

    // 构建文件名和内容
    const fileName = `${input.id}#${input.title}.md`;
    const mdContent = this.buildMdContent(entry);

    if (input.scope === Scope.Workspace && input.workspace) {
      const workspaceStore = this.dataStore.workspace(input.workspace.path);
      const filePath = `${FileKnowledgeRepository.DIR}/${fileName}`;
      workspaceStore.writeFile(filePath, mdContent);

      const workspaceEntries = this.workspaceEntries.get(input.workspace.path) ?? [];
      workspaceEntries.push(entry);
      this.workspaceEntries.set(input.workspace.path, workspaceEntries);
    } else {
      const filePath = `${FileKnowledgeRepository.DIR}/${fileName}`;
      this.dataStore.writeFile(filePath, mdContent);
      this.platformEntries.push(entry);
    }

    return entry;
  }

  remove(input: RemoveKnowledgeInput): void {
    if (input.scope === Scope.Workspace && input.workspace) {
      const workspaceStore = this.dataStore.workspace(input.workspace.path);
      const entries = this.workspaceEntries.get(input.workspace.path) ?? [];
      const index = entries.findIndex(e => e.id === input.id);

      if (index === -1) {
        throw new Error(`Knowledge entry not found: ${input.id}`);
      }

      const entry = entries[index];
      const fileName = `${entry.id}#${entry.title}.md`;
      const filePath = `${FileKnowledgeRepository.DIR}/${fileName}`;

      workspaceStore.deleteFile(filePath);
      entries.splice(index, 1);
    } else {
      const index = this.platformEntries.findIndex(e => e.id === input.id);

      if (index === -1) {
        throw new Error(`Knowledge entry not found: ${input.id}`);
      }

      const entry = this.platformEntries[index];
      const fileName = `${entry.id}#${entry.title}.md`;
      const filePath = `${FileKnowledgeRepository.DIR}/${fileName}`;

      this.dataStore.deleteFile(filePath);
      this.platformEntries.splice(index, 1);
    }
  }

  private loadPlatformEntries(): void {
    this.platformEntries = this.loadEntries(this.dataStore, Scope.Platform);
  }

  private loadWorkspaceEntries(workspaces: Workspace[]): void {
    for (const workspace of workspaces) {
      const workspaceStore = this.dataStore.workspace(workspace.path);
      const entries = this.loadEntries(workspaceStore, Scope.Workspace);
      this.workspaceEntries.set(workspace.path, entries);
    }
  }

  private loadEntries(store: FileDataStore, scope: Scope): KnowledgeEntry[] {
    const dir = FileKnowledgeRepository.DIR;
    if (!store.exists(dir)) return [];

    const files = store.listDir(dir).filter(f => f.endsWith(".md"));
    const entries: KnowledgeEntry[] = [];

    for (const file of files) {
      const filePath = `${dir}/${file}`;
      const raw = store.readFile(filePath);
      if (!raw) continue;

      try {
        const entry = this.parseMdFile(file, raw, scope);

        // 容错：文件名不符合 {id}#{title}.md 时，以 frontmatter 为准，更新文件名
        const expectedFileName = `${entry.id}#${entry.title}.md`;
        if (file !== expectedFileName) {
          const newFilePath = `${dir}/${expectedFileName}`;
          store.writeFile(newFilePath, raw);
          store.deleteFile(filePath);
          console.warn(`Renamed knowledge file: ${file} → ${expectedFileName}`);
        }

        entries.push(entry);
      } catch (err) {
        console.warn(`Failed to parse knowledge entry: ${filePath}`, err);
      }
    }

    return entries;
  }

  private parseMdFile(fileName: string, raw: string, scope: Scope): KnowledgeEntry {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) throw new Error("Invalid knowledge entry format: missing frontmatter");

    const [, frontmatter, content] = match;
    const meta = this.parseFrontmatter(frontmatter);

    if (!meta.id) throw new Error("Knowledge entry missing 'id'");
    if (!meta.title) throw new Error("Knowledge entry missing 'title'");

    return {
      id: meta.id,
      title: meta.title,
      tags: this.parseTags(meta.tags),
      content: content.trim(),
      scope,
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

  private parseTags(tags: string | undefined): string[] {
    if (!tags) return [];
    if (tags.startsWith("[") && tags.endsWith("]")) {
      return tags.slice(1, -1).split(",").map(t => t.trim().replace(/^["']|["']$/g, ""));
    }
    return [tags];
  }

  private buildMdContent(entry: KnowledgeEntry): string {
    const tags = entry.tags.length > 0 ? `[${entry.tags.join(", ")}]` : "[]";
    return `---\nid: ${entry.id}\ntitle: ${entry.title}\ntags: ${tags}\n---\n${entry.content}`;
  }
}
