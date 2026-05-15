import type { StageRoleDefinition, ProjectStageDefinition } from "../shared/types";

/** 角色定义，来源于 DB 的 stage_role_definition。 */
export type RoleDefinition = StageRoleDefinition;

/** @deprecated 使用 RoleDefinition */
export type SnailDefinition = RoleDefinition;

/** @deprecated 使用 RoleDefinition */
export type AgentSnailDefinition = RoleDefinition;

export interface StageRoleBinding {
  projectId: string;
  stageKey: string;
  snailId: string;
  isPrimary: boolean;
  workingRules: string[];
}

/** 从 ConversationStore 读取的 role/stage definition 查询接口。 */
export interface RoleDefinitionStore {
  listAllRoleDefinitions(): Array<StageRoleDefinition & { project_id: string }>;
  getStageDefinition(id: string): ProjectStageDefinition | undefined;
}

export class RoleRegistry {
  /** 主索引：role.id → RoleDefinition（全局唯一，无 key 冲突）。 */
  private rolesById = new Map<string, RoleDefinition>();
  /** 辅助索引：projectId:name → RoleDefinition（项目内按 name 查找）。 */
  private rolesByProjectName = new Map<string, RoleDefinition>();
  /** stage 索引：projectId:stageKey → roleId[]。 */
  private stageRoles = new Map<string, string[]>();
  private store: RoleDefinitionStore;

  constructor(store: RoleDefinitionStore) {
    this.store = store;
    this.loadFromStore();
  }

  /** 从 store 重新加载所有 role definitions（用于新建项目后刷新）。 */
  reloadFromStore(): void {
    this.rolesById.clear();
    this.rolesByProjectName.clear();
    this.stageRoles.clear();
    this.loadFromStore();
  }

  private loadFromStore(): void {
    for (const rd of this.store.listAllRoleDefinitions()) {
      this.rolesById.set(rd.id, rd);
      this.rolesByProjectName.set(`${rd.project_id}:${rd.name}`, rd);
      const stageDef = this.store.getStageDefinition(rd.stage_definition_id);
      const stageKey = stageDef ? `${rd.project_id}:${stageDef.key}` : `${rd.project_id}:${rd.stage_definition_id}`;
      const existing = this.stageRoles.get(stageKey) ?? [];
      if (!existing.includes(rd.id)) {
        existing.push(rd.id);
      }
      this.stageRoles.set(stageKey, existing);
    }
  }

  /** 按 role ID 查找（全局唯一，推荐使用）。 */
  getById(id: string): RoleDefinition | undefined {
    return this.rolesById.get(id);
  }

  /** 按项目内角色名查找。同一项目内 name 应唯一。 */
  getByName(projectId: string, name: string): RoleDefinition | undefined {
    return this.rolesByProjectName.get(`${projectId}:${name}`);
  }

  /** @deprecated 使用 getById() 或 getByName() */
  get(name: string): RoleDefinition | undefined {
    for (const rd of this.rolesById.values()) {
      if (rd.name === name) return rd;
    }
    return undefined;
  }

  /** @deprecated 使用 getById() 或 getByName() */
  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  list(): RoleDefinition[] {
    return Array.from(this.rolesById.values());
  }

  listByStageType(projectId: string, stageType: string): RoleDefinition[] {
    const key = `${projectId}:${stageType}`;
    return (this.stageRoles.get(key) ?? [])
      .map((id) => this.rolesById.get(id))
      .filter(Boolean) as RoleDefinition[];
  }

  getPrimaryForStageType(projectId: string, stageType: string): RoleDefinition {
    const roles = this.listByStageType(projectId, stageType);
    const primary = roles.find((r) => r.is_primary === 1) ?? roles[0];
    if (!primary) {
      throw new Error(`No roles configured for stage type: ${stageType} in project ${projectId}`);
    }
    return primary;
  }

  /** 按 role ID 获取关联的 snail den template ID。 */
  getSnailTemplateId(id: string): string | null {
    return this.rolesById.get(id)?.snail_template_id ?? null;
  }
}

/** @deprecated 使用 RoleRegistry */
export const SnailRegistry = RoleRegistry;
