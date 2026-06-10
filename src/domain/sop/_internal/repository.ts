import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type { Workspace, Scope } from "@domain/workspace/model";
import type { Sop, StageDefinition, RoleDefinition, Transition } from "@domain/sop/model";
import type { FileSystem } from "@infra/file-system";

/** SOP 持久层接口 */
export interface SopRepository {
  list(): Sop[];
  findByKey(key: string): Sop | undefined;
  findByWorkspace(workspace: Workspace): Sop[];
}

/** SOP 文件存储实现 */
export class FileSopRepository implements SopRepository {
  private platformSops: Sop[] = [];
  private workspaceSops = new Map<string, Sop[]>();  // workspace_path -> sops

  constructor(private fileSystem: FileSystem, repoRoot: string, workspacePaths: string[]) {
    this.loadPlatformSops(repoRoot);
    this.loadWorkspaceSops(workspacePaths);
  }

  list(): Sop[] {
    return [...this.platformSops, ...this.workspaceSops.values()].flat();
  }

  findByKey(key: string): Sop | undefined {
    return this.list().find(s => s.key === key);
  }

  findByWorkspace(workspace: Workspace): Sop[] {
    const wsSops = this.workspaceSops.get(workspace.path) ?? [];
    return [...this.platformSops, ...wsSops];
  }

  private loadPlatformSops(repoRoot: string): void {
    const sopDir = path.join(repoRoot, "config", "sop");
    this.platformSops = this.loadSopDir(sopDir, "platform");
  }

  private loadWorkspaceSops(workspacePaths: string[]): void {
    for (const wsPath of workspacePaths) {
      const wsSopDir = path.join(wsPath, ".snail", "config", "sop");
      const sops = this.loadSopDir(wsSopDir, "workspace");
      this.workspaceSops.set(wsPath, sops);
    }
  }

  private loadSopDir(dir: string, scope: Scope): Sop[] {
    if (!this.fileSystem.exists(dir)) return [];

    const entries = this.fileSystem.listDirs(dir);
    const sops: Sop[] = [];

    for (const entry of entries) {
      const yamlFile = path.join(dir, entry, `${entry}.yaml`);
      const raw = this.fileSystem.readFile(yamlFile);
      if (!raw) continue;

      try {
        const data = parseYaml(raw);
        const sop = this.parseSop(entry, data, path.join(dir, entry), scope);
        sops.push(sop);
      } catch (err) {
        console.warn(`Failed to parse SOP: ${yamlFile}`, err);
      }
    }

    return sops;
  }

  private parseSop(key: string, data: Record<string, unknown>, sopDir: string, scope: Scope): Sop {
    if (!data.name) throw new Error(`SOP missing name: ${key}`);

    const stageDefinitions = (data.stage_definitions as Array<Record<string, unknown>>)?.map(sd =>
      this.parseStageDefinition(sd, sopDir)
    ) ?? [];

    const transitions = (data.transitions as Array<Record<string, unknown>>)?.map(t =>
      this.parseTransition(t)
    ) ?? [];

    return {
      key,
      name: data.name as string,
      description: (data.description as string) ?? null,
      shared_handbook: this.resolveFileRef(data.shared_handbook as string | undefined, sopDir),
      stage_definitions: stageDefinitions,
      transitions,
      scope,
    };
  }

  private parseStageDefinition(data: Record<string, unknown>, sopDir: string): StageDefinition {
    if (!data.key) throw new Error("Stage definition missing key");
    if (!data.title) throw new Error(`Stage definition missing title: ${data.key}`);

    const roles = (data.roles as Array<Record<string, unknown>>)?.map(r =>
      this.parseRoleDefinition(r, sopDir)
    ) ?? [];

    return {
      key: data.key as string,
      title: data.title as string,
      description: (data.description as string) ?? "",
      roles,
    };
  }

  private parseRoleDefinition(data: Record<string, unknown>, sopDir: string): RoleDefinition {
    if (!data.key) throw new Error("Role definition missing key");
    if (!data.name) throw new Error(`Role definition missing name: ${data.key}`);

    return {
      key: data.key as string,
      name: data.name as string,
      description: (data.description as string) ?? "",
      is_primary: (data.is_primary as boolean) ?? false,
      count: (data.count as number) ?? 1,
      handbook: this.resolveFileRef(data.handbook as string | undefined, sopDir),
    };
  }

  private parseTransition(data: Record<string, unknown>): Transition {
    if (!data.from) throw new Error("Transition missing from");
    if (!data.to) throw new Error("Transition missing to");

    return {
      from: data.from as string,
      to: data.to as string,
      guard: (data.guard as string) ?? null,
    };
  }

  private resolveFileRef(ref: string | undefined, sopDir: string): string | null {
    if (!ref) return null;
    if (!ref.startsWith("@")) return ref;

    const fileName = ref.slice(1);
    const filePath = path.join(sopDir, fileName);
    const content = this.fileSystem.readFile(filePath);
    if (content) return content.trim();

    console.warn(`File reference not found: ${filePath}`);
    return ref;
  }
}
