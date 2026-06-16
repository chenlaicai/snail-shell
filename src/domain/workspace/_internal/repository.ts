import type { Workspace, CreateWorkspaceInput } from "@domain/workspace/model";
import type { FileDataStore } from "@infra/file-data-store";

/** Workspace 持久层接口 */
export interface WorkspaceRepository {
  list(limit?: number, offset?: number): Workspace[];
  add(input: CreateWorkspaceInput): Workspace;
}

/** Workspace 文件存储实现 */
export class FileWorkspaceRepository implements WorkspaceRepository {
  private cache = new Map<string, Workspace>();

  constructor(private dataStore: FileDataStore) {
    this.load();
  }

  list(limit = 50, offset = 0): Workspace[] {
    const all = [...this.cache.values()];
    return all.slice(offset, offset + limit);
  }

  add(input: CreateWorkspaceInput): Workspace {
    if (this.cache.has(input.path)) {
      throw new Error(`Workspace already exists: ${input.path}`);
    }

    const workspace: Workspace = {
      path: input.path,
      summary: input.summary ?? null,
    };

    this.cache.set(workspace.path, workspace);
    this.save();
    return workspace;
  }

  private load(): void {
    const paths = this.dataStore.readJson<string[]>("workspaces.json");
    if (!paths) return;

    for (const p of paths) {
      this.cache.set(p, { path: p, summary: null });
    }
  }

  private save(): void {
    this.dataStore.writeJson("workspaces.json", [...this.cache.keys()]);
  }
}
