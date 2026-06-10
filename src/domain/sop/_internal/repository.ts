import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type { Sop, StageDefinition, RoleDefinition, Transition, TransitionGuard } from "@domain/sop/model";
import type { FileSystem } from "@infra/file-system";

/** SOP 持久层接口 */
export interface SopRepository {
  list(): Sop[];
  findByKey(key: string): Sop | undefined;
}

/** SOP 文件存储实现 */
export class FileSopRepository implements SopRepository {
  private cache = new Map<string, Sop>();

  constructor(private fileSystem: FileSystem, repoRoot: string) {
    const sopDir = path.join(repoRoot, "config", "sop");
    this.loadDir(sopDir);
  }

  list(): Sop[] {
    return [...this.cache.values()];
  }

  findByKey(key: string): Sop | undefined {
    return this.cache.get(key);
  }

  private loadDir(dir: string): void {
    if (!this.fileSystem.exists(dir)) return;

    const entries = this.fileSystem.listDirs(dir);
    for (const entry of entries) {
      const yamlFile = path.join(dir, entry, `${entry}.yaml`);
      const raw = this.fileSystem.readFile(yamlFile);
      if (!raw) continue;

      try {
        const data = parseYaml(raw);
        const sop = this.parseSop(entry, data, path.join(dir, entry));
        this.cache.set(sop.key, sop);
      } catch (err) {
        console.warn(`Failed to parse SOP: ${yamlFile}`, err);
      }
    }
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
      first_stage: (data.first_stage as string) ?? null,
      shared_handbook: this.resolveFileRef(data.shared_handbook as string | undefined, sopDir),
      stage_definitions: stageDefinitions,
      transitions,
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
      sequence: (data.sequence as number) ?? 0,
      input_description: (data.input_description as string) ?? null,
      output_description: (data.output_description as string) ?? null,
      acceptance_focus: (data.acceptance_focus as string[]) ?? [],
      acceptance_checklist: (data.acceptance_checklist as Array<Record<string, unknown>>)?.map(c => ({
        id: c.id as string,
        description: c.description as string,
        required: (c.required as boolean) ?? false,
      })) ?? [],
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

    let guard: TransitionGuard | null = null;
    if (data.guard) {
      const g = data.guard as Record<string, unknown>;
      guard = {
        type: g.type as string,
        config: (g.config as Record<string, unknown>) ?? {},
      };
    }

    return {
      from: data.from as string,
      to: data.to as string,
      guard,
    };
  }

  private resolveFileRef(ref: string | undefined, sopDir: string): string | null {
    if (!ref) return null;
    if (!ref.startsWith("@")) return ref;

    const fileName = ref.slice(1);
    const filePath = path.join(sopDir, fileName);
    const content = this.fileSystem.readFile(filePath);
    if (content) {
      return content.trim();
    }

    console.warn(`File reference not found: ${filePath}`);
    return ref;
  }
}
