import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Workspace } from "@domain/workspace/model";
import { Scope } from "@domain/workspace/model";
import type { Sop, StageDefinition, RoleDefinition, Transition } from "@domain/sop/model";
import type { FileDataStore } from "@infra/file-data-store";
import { getLogger } from "@infra/logger";

export interface SopValidationError {
  rule: string;
  level: "block" | "warn";
  message: string;
}

/**
 * SOP 校验规则 S1-S6
 * S1: 至少 1 个 stage（阻断）
 * S2: 每个 stage 至少 1 个 role（阻断）
 * S3: transitions 引用的 stage key 必须在 stages 中定义（阻断）
 * S4: 涉及代码变更的 SOP 必须有 review stage（阻断）
 * S5: SOP 必须有且仅有一个入口 stage（阻断）
 * S6: gate 覆盖度不足（警告）
 */
export function validateSop(sop: Sop): SopValidationError[] {
  const errors: SopValidationError[] = [];
  const stageKeys = new Set(sop.stage_definitions.map(sd => sd.key));

  if (sop.stage_definitions.length === 0) {
    errors.push({ rule: "S1", level: "block", message: "SOP must have at least 1 stage" });
  }

  validateStageRoles(sop, errors);
  validateTransitionKeys(sop, stageKeys, errors);
  validateCodeReviewRequirement(sop, errors);
  validateEntryStage(sop, errors);
  validateGateCoverage(sop, errors);

  return errors;
}

function validateStageRoles(sop: Sop, errors: SopValidationError[]): void {
  for (const sd of sop.stage_definitions) {
    if (sd.roles.length === 0) {
      errors.push({ rule: "S2", level: "block", message: `Stage "${sd.key}" must have at least 1 role` });
    }
  }
}

function validateTransitionKeys(sop: Sop, stageKeys: Set<string>, errors: SopValidationError[]): void {
  for (const t of sop.transitions) {
    if (!stageKeys.has(t.from)) errors.push({ rule: "S3", level: "block", message: `Transition references unknown stage: "${t.from}"` });
    if (!stageKeys.has(t.to)) errors.push({ rule: "S3", level: "block", message: `Transition references unknown stage: "${t.to}"` });
  }
}

function validateCodeReviewRequirement(sop: Sop, errors: SopValidationError[]): void {
  const hasCodeStage = sop.stage_definitions.some(sd => sd.key === "development" || sd.key === "prototype");
  if (hasCodeStage && !sop.stage_definitions.some(sd => sd.key === "review")) {
    errors.push({ rule: "S4", level: "block", message: "SOP with code stages must have a review stage" });
  }
}

function validateEntryStage(sop: Sop, errors: SopValidationError[]): void {
  const incomingTargets = new Set(sop.transitions.map(t => t.to));
  const entryCount = sop.stage_definitions.filter(sd => !incomingTargets.has(sd.key)).length;
  if (entryCount !== 1) {
    errors.push({ rule: "S5", level: "block", message: `SOP must have exactly 1 entry stage, found ${entryCount}` });
  }
}

function validateGateCoverage(sop: Sop, errors: SopValidationError[]): void {
  for (const sd of sop.stage_definitions) {
    const gateCount = sd.gate_ids?.length ?? 0;
    if (gateCount > 0 && gateCount < 2) {
      errors.push({ rule: "S6", level: "warn", message: `Stage "${sd.key}" has only ${gateCount} gate(s), recommend at least 2` });
    }
  }
}

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
    const store = this.getStoreForScope(sop);
    const dir = `${FileSopRepository.DIR}/${sop.key}`;
    store.ensureDir(dir);
    store.writeFile(`${dir}/${sop.key}.yaml`, this.serializeSop(sop));
    if (sop.scope === Scope.Workspace && sop.workspace) {
      const sops = this.workspaceSops.get(sop.workspace.path) ?? [];
      sops.push(sop);
      this.workspaceSops.set(sop.workspace.path, sops);
    } else {
      this.platformSops.push(sop);
    }
    return sop;
  }

  update(key: string, patch: Partial<Omit<Sop, 'key' | 'scope'>>): Sop {
    const { sop: existing, store } = this.findByKeyWithStore(key);
    if (!existing) {
      throw new Error(`SOP with key '${key}' not found`);
    }
    const updated: Sop = { ...existing, ...patch, key };
    const dir = `${FileSopRepository.DIR}/${key}`;
    store.writeFile(`${dir}/${key}.yaml`, this.serializeSop(updated));

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
    const { sop: existing, store } = this.findByKeyWithStore(key);
    if (!existing) {
      throw new Error(`SOP with key '${key}' not found`);
    }
    store.deleteDir(`${FileSopRepository.DIR}/${key}`);

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

  private getStoreForScope(sop: Sop): FileDataStore {
    if (sop.scope === Scope.Workspace && sop.workspace) {
      return this.dataStore.workspace(sop.workspace.path);
    }
    return this.dataStore;
  }

  private findByKeyWithStore(key: string): { sop: Sop | undefined; store: FileDataStore } {
    const platformSop = this.platformSops.find(s => s.key === key);
    if (platformSop) return { sop: platformSop, store: this.dataStore };
    for (const [wsPath, sops] of this.workspaceSops) {
      const wsSop = sops.find(s => s.key === key);
      if (wsSop) return { sop: wsSop, store: this.dataStore.workspace(wsPath) };
    }
    return { sop: undefined, store: this.dataStore };
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

    const gateIds = Array.isArray(data.gate_ids) ? (data.gate_ids as string[]) : null;

    return {
      key: data.key as string,
      title: data.title as string,
      description: (data.description as string) ?? "",
      roles,
      gate_ids: gateIds,
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
    if (sop.description != null) data.description = sop.description;
    if (sop.shared_skill != null) data.shared_skill = sop.shared_skill;

    data.stage_definitions = sop.stage_definitions.map(sd => {
      const stage: Record<string, unknown> = { key: sd.key, title: sd.title };
      if (sd.description != null) stage.description = sd.description;
      if (sd.gate_ids != null) stage.gate_ids = sd.gate_ids;
      stage.roles = sd.roles.map(r => {
        const role: Record<string, unknown> = { key: r.key, name: r.name };
        if (r.description != null) role.description = r.description;
        if (r.is_primary) role.is_primary = r.is_primary;
        if (r.count != null && r.count !== 1) role.count = r.count;
        if (r.skill != null) role.skill = r.skill;
        if (r.prohibition != null) role.prohibition = r.prohibition;
        if (r.self_check != null) role.self_check = r.self_check;
        return role;
      });
      return stage;
    });

    data.transitions = sop.transitions.map(t => {
      const transition: Record<string, unknown> = { from: t.from, to: t.to };
      if (t.guard != null) transition.guard = t.guard;
      return transition;
    });

    return stringifyYaml(data, { lineWidth: 120 });
  }
}
