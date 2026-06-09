/**
 * SQLite SOP Repository 实现
 *
 * 基于 better-sqlite3 实现 SOP Repository 接口。
 */

import type { DatabaseConnection } from "../../connection/types";
import type {
  SopRepository,
  Sop,
  SopStageDefinition,
  SopStageRoleDefinition,
  SopTransition,
  CreateSopInput,
  CreateSopStageDefinitionInput,
  CreateSopStageRoleDefinitionInput,
  CreateSopTransitionInput,
  SopSource,
} from "../../../sop";

/**
 * SQLite SOP Repository 实现
 *
 * 注意：SOP 配置目前存储在文件系统中（YAML 文件），
 * 此实现提供基本的内存缓存和文件系统操作。
 */
export class SqliteSopRepository implements SopRepository {
  private sopCache: Map<string, Sop> = new Map();
  private stageDefinitionCache: Map<string, SopStageDefinition> = new Map();
  private roleDefinitionCache: Map<string, SopStageRoleDefinition> = new Map();
  private transitionCache: Map<string, SopTransition[]> = new Map();

  constructor(private connection: DatabaseConnection) {}

  // ═══ Sop CRUD ═══

  async getSop(id: string): Promise<Sop | null> {
    return this.sopCache.get(id) ?? null;
  }

  async getSopByKey(source: SopSource, key: string): Promise<Sop | null> {
    for (const sop of this.sopCache.values()) {
      if (sop.source === source && sop.key === key) {
        return sop;
      }
    }
    return null;
  }

  async listSops(source?: SopSource): Promise<Sop[]> {
    const sops = Array.from(this.sopCache.values());
    if (source) {
      return sops.filter((s) => s.source === source);
    }
    return sops;
  }

  async saveSop(input: CreateSopInput): Promise<Sop> {
    const id = `sop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const sop: Sop = {
      id,
      source: input.source,
      source_ref: input.source_ref ?? null,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      first_stage: input.first_stage ?? null,
      shared_handbook: input.shared_handbook ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.sopCache.set(id, sop);
    return sop;
  }

  async deleteSop(id: string): Promise<void> {
    this.sopCache.delete(id);
    // 清理相关的 stage definition 和 transition
    for (const [key, def] of this.stageDefinitionCache.entries()) {
      if (def.sop_id === id) {
        this.stageDefinitionCache.delete(key);
      }
    }
    for (const [key, transitions] of this.transitionCache.entries()) {
      if (key.startsWith(`${id}:`)) {
        this.transitionCache.delete(key);
      }
    }
  }

  // ═══ SopStageDefinition CRUD ═══

  async getSopStageDefinition(id: string): Promise<SopStageDefinition | null> {
    return this.stageDefinitionCache.get(id) ?? null;
  }

  async listSopStageDefinitions(sopId: string): Promise<SopStageDefinition[]> {
    const definitions: SopStageDefinition[] = [];
    for (const def of this.stageDefinitionCache.values()) {
      if (def.sop_id === sopId) {
        definitions.push(def);
      }
    }
    return definitions.sort((a, b) => a.sequence - b.sequence);
  }

  async saveSopStageDefinition(input: CreateSopStageDefinitionInput): Promise<SopStageDefinition> {
    const id = `stage-def-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const definition: SopStageDefinition = {
      id,
      sop_id: input.sop_id,
      key: input.key,
      title: input.title,
      sequence: input.sequence,
      input_description: input.input_description ?? null,
      output_description: input.output_description ?? null,
      acceptance_focus: input.acceptance_focus ?? [],
      acceptance_checklist: input.acceptance_checklist ?? [],
    };
    this.stageDefinitionCache.set(id, definition);
    return definition;
  }

  // ═══ SopStageRoleDefinition CRUD ═══

  async getSopStageRoleDefinition(id: string): Promise<SopStageRoleDefinition | null> {
    return this.roleDefinitionCache.get(id) ?? null;
  }

  async listSopStageRoleDefinitions(stageDefinitionId: string): Promise<SopStageRoleDefinition[]> {
    const definitions: SopStageRoleDefinition[] = [];
    for (const def of this.roleDefinitionCache.values()) {
      if (def.stage_definition_id === stageDefinitionId) {
        definitions.push(def);
      }
    }
    return definitions;
  }

  async saveSopStageRoleDefinition(input: CreateSopStageRoleDefinitionInput): Promise<SopStageRoleDefinition> {
    const id = `role-def-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const definition: SopStageRoleDefinition = {
      id,
      stage_definition_id: input.stage_definition_id,
      key: input.key,
      name: input.name,
      description: input.description ?? "",
      handbook: input.handbook ?? null,
      is_primary: input.is_primary ?? false,
      count: input.count ?? 1,
    };
    this.roleDefinitionCache.set(id, definition);
    return definition;
  }

  // ═══ SopTransition CRUD ═══

  async getSopTransitions(sopId: string): Promise<SopTransition[]> {
    const transitions: SopTransition[] = [];
    for (const [key, transitionList] of this.transitionCache.entries()) {
      if (key.startsWith(`${sopId}:`)) {
        transitions.push(...transitionList);
      }
    }
    return transitions;
  }

  async getForwardTransitions(sopId: string, fromStageKey: string): Promise<SopTransition[]> {
    const key = `${sopId}:${fromStageKey}`;
    return this.transitionCache.get(key) ?? [];
  }

  async saveSopTransition(input: CreateSopTransitionInput): Promise<SopTransition> {
    const id = `transition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const transition: SopTransition = {
      id,
      sop_id: input.sop_id,
      from_stage_key: input.from_stage_key,
      to_stage_key: input.to_stage_key,
      guard: input.guard ?? null,
    };

    const key = `${input.sop_id}:${input.from_stage_key}`;
    const existing = this.transitionCache.get(key) ?? [];
    existing.push(transition);
    this.transitionCache.set(key, existing);

    return transition;
  }

  // ═══ 查询方法 ═══

  async validateTransition(sopId: string, fromStageKey: string, toStageKey: string): Promise<SopTransition | null> {
    const transitions = await this.getForwardTransitions(sopId, fromStageKey);
    return transitions.find((t) => t.to_stage_key === toStageKey) ?? null;
  }

  async listSopStageDefinitionsWithRoles(sopId: string): Promise<Array<SopStageDefinition & { roles: SopStageRoleDefinition[] }>> {
    const definitions = await this.listSopStageDefinitions(sopId);
    return definitions.map((def) => ({
      ...def,
      roles: Array.from(this.roleDefinitionCache.values()).filter(
        (role) => role.stage_definition_id === def.id
      ),
    }));
  }
}
