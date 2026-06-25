import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Workspace } from "@domain/workspace/model";
import { Scope } from "@domain/workspace/model";
import type { Sop, StageDefinition, RoleDefinition, Transition } from "@domain/sop/model";
import type { FileDataStore } from "@infra/file-data-store";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "sop" });

/** SOP 持久层接口 */
export interface SopRepository {
  list(): Sop[];
  findByKey(key: string): Sop | undefined;
  findByWorkspace(workspace: Workspace): Sop[];
  create(sop: Sop): Sop;
  update(key: string, patch: Partial<Omit<Sop, 'key' | 'scope'>>): Sop;
  remove(key: string): void;
}

/** SOP 文件存储实现 */
export class FileSopRepository implements SopRepository {
  private static readonly DIR = "sops";

  private platformSops: Sop[] = [];
  private workspaceSops = new Map<string, Sop[]>();

  constructor(private dataStore: FileDataStore, workspaces: Workspace[]) {
    this.platformSops = this.loadSopDir(this.dataStore);
    for (const workspace of workspaces) {
      const workspaceStore = this.dataStore.workspace(workspace.path);
      const sops = this.loadSopDir(workspaceStore)
        .map(s => ({ ...s, scope: Scope.Workspace, workspace }));
      this.workspaceSops.set(workspace.path, sops);
    }
  }

  list(): Sop[] {
    return [...this.platformSops, ...this.workspaceSops.values()].flat();
  }

  findByKey(key: string): Sop | undefined {
    return this.list().find(s => s.key === key);
  }

  findByWorkspace(workspace: Workspace): Sop[] {
    const workspaceSops = this.workspaceSops.get(workspace.path) ?? [];
    return [...this.platformSops, ...workspaceSops];
  }

  create(sop: Sop): Sop {
    if (this.findByKey(sop.key)) {
      throw new Error(`SOP with key '${sop.key}' already exists`);
    }
    const dir = `${FileSopRepository.DIR}/${sop.key}`;
    this.dataStore.ensureDir(dir);
    this.dataStore.writeFile(`${dir}/${sop.key}.yaml`, this.serializeSop(sop));
    this.platformSops.push(sop);
    return sop;
  }

  update(key: string, patch: Partial<Omit<Sop, 'key' | 'scope'>>): Sop {
    const existing = this.findByKey(key);
    if (!existing) {
      throw new Error(`SOP with key '${key}' not found`);
    }
    const updated: Sop = { ...existing, ...patch, key };
    const dir = `${FileSopRepository.DIR}/${key}`;
    this.dataStore.writeFile(`${dir}/${key}.yaml`, this.serializeSop(updated));

    // Update in-memory cache
    const platformIdx = this.platformSops.findIndex(s => s.key === key);
    if (platformIdx !== -1) {
      this.platformSops[platformIdx] = updated;
    } else {
      for (const [wsPath, sops] of this.workspaceSops) {
        const wsIdx = sops.findIndex(s => s.key === key);
        if (wsIdx !== -1) {
          sops[wsIdx] = updated;
          this.workspaceSops.set(wsPath, sops);
          break;
        }
      }
    }
    return updated;
  }

  remove(key: string): void {
    const existing = this.findByKey(key);
    if (!existing) {
      throw new Error(`SOP with key '${key}' not found`);
    }
    this.dataStore.deleteDir(`${FileSopRepository.DIR}/${key}`);

    // Update in-memory cache
    const platformIdx = this.platformSops.findIndex(s => s.key === key);
    if (platformIdx !== -1) {
      this.platformSops.splice(platformIdx, 1);
    } else {
      for (const [wsPath, sops] of this.workspaceSops) {
        const wsIdx = sops.findIndex(s => s.key === key);
        if (wsIdx !== -1) {
          sops.splice(wsIdx, 1);
          this.workspaceSops.set(wsPath, sops);
          break;
        }
      }
    }
  }

  private loadSopDir(store: FileDataStore): Sop[] {
    const relativeDir = FileSopRepository.DIR;
    if (!store.exists(relativeDir)) return [];

    const entries = store.listDirs(relativeDir);
    const sops: Sop[] = [];

    for (const entry of entries) {
      const yamlPath = `${relativeDir}/${entry}/${entry}.yaml`;
      const raw = store.readFile(yamlPath);
      if (!raw) continue;

      try {
        const data = parseYaml(raw);
        const sop = this.parseSop(entry, data, `${relativeDir}/${entry}`);
        sops.push(sop);
      } catch (err) {
        log.warn({ err, yamlPath }, "Failed to parse SOP");
      }
    }

    return sops;
  }

  private parseSop(key: string, data: Record<string, unknown>, sopDir: string): Sop {
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
      shared_skill: (data.shared_skill as string) ?? null,
      stage_definitions: stageDefinitions,
      transitions,
      scope: Scope.Platform,
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

  private parseRoleDefinition(data: Record<string, unknown>, _sopDir: string): RoleDefinition {
    if (!data.key) throw new Error("Role definition missing key");
    if (!data.name) throw new Error(`Role definition missing name: ${data.key}`);

    return {
      key: data.key as string,
      name: data.name as string,
      description: (data.description as string) ?? "",
      is_primary: (data.is_primary as boolean) ?? false,
      count: (data.count as number) ?? 1,
      skill: (data.skill as string) ?? null,
      prohibition: (data.prohibition as string) ?? null,
      self_check: (data.self_check as string) ?? null,
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

  private serializeSop(sop: Sop): string {
    const data: Record<string, unknown> = {
      name: sop.name,
    };
    if (sop.description) data.description = sop.description;
    if (sop.shared_skill) data.shared_skill = sop.shared_skill;

    data.stage_definitions = sop.stage_definitions.map(sd => {
      const stage: Record<string, unknown> = { key: sd.key, title: sd.title };
      if (sd.description) stage.description = sd.description;
      stage.roles = sd.roles.map(r => {
        const role: Record<string, unknown> = { key: r.key, name: r.name };
        if (r.description) role.description = r.description;
        if (r.is_primary) role.is_primary = r.is_primary;
        if (r.count !== 1) role.count = r.count;
        if (r.skill) role.skill = r.skill;
        if (r.prohibition) role.prohibition = r.prohibition;
        if (r.self_check) role.self_check = r.self_check;
        return role;
      });
      return stage;
    });

    data.transitions = sop.transitions.map(t => {
      const transition: Record<string, unknown> = { from: t.from, to: t.to };
      if (t.guard) transition.guard = t.guard;
      return transition;
    });

    return stringifyYaml(data, { lineWidth: 120 });
  }
}
