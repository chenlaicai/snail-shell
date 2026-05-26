import type { StageRoleDefinition, ProjectStageDefinition } from "../shared/types";

/** 角色定义，来源于 DB 的 stage_role + role_definition 桥接查询。 */
export type RoleDefinition = StageRoleDefinition;

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
  /** 主索引：projectId:roleId → RoleDefinition（跨项目共享 SOP 时同一 stage_role 在不同项目有不同绑定）。 */
  private rolesById = new Map<string, RoleDefinition>();
  /** 辅助索引：projectId:stageDefinitionId:name → RoleDefinition。 */
  private rolesByStageDefinitionName = new Map<string, RoleDefinition>();
  /** stage 索引：projectId:stageKey → compositeKey[]。 */
  private stageRoles = new Map<string, string[]>();
  private store: RoleDefinitionStore;

  constructor(store: RoleDefinitionStore) {
    this.store = store;
    this.loadFromStore();
  }

  /** 从 store 重新加载所有 role definitions（用于新建项目后刷新）。 */
  reloadFromStore(): void {
    this.rolesById.clear();
    this.rolesByStageDefinitionName.clear();
    this.stageRoles.clear();
    this.loadFromStore();
  }

  private loadFromStore(): void {
    for (const rd of this.store.listAllRoleDefinitions()) {
      const compositeKey = `${rd.project_id}:${rd.id}`;
      this.rolesById.set(compositeKey, rd);
      this.rolesByStageDefinitionName.set(`${rd.project_id}:${rd.stage_definition_id}:${rd.name}`, rd);
      const stageDef = this.store.getStageDefinition(rd.stage_definition_id);
      const stageKey = stageDef ? `${rd.project_id}:${stageDef.key}` : `${rd.project_id}:${rd.stage_definition_id}`;
      const existing = this.stageRoles.get(stageKey) ?? [];
      if (!existing.includes(compositeKey)) {
        existing.push(compositeKey);
      }
      this.stageRoles.set(stageKey, existing);
    }
  }

  getById(projectId: string, id: string): RoleDefinition | undefined {
    return this.rolesById.get(`${projectId}:${id}`);
  }

  getByStageDefinitionName(projectId: string, stageDefinitionId: string, name: string): RoleDefinition | undefined {
    return this.rolesByStageDefinitionName.get(`${projectId}:${stageDefinitionId}:${name}`);
  }

  list(): RoleDefinition[] {
    return Array.from(this.rolesById.values());
  }

  listByStageType(projectId: string, stageType: string): RoleDefinition[] {
    const key = `${projectId}:${stageType}`;
    return (this.stageRoles.get(key) ?? [])
      .map((compositeKey) => this.rolesById.get(compositeKey))
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

  getSnailTemplateId(projectId: string, id: string): string | null {
    return this.rolesById.get(`${projectId}:${id}`)?.snail_template_id ?? null;
  }
}
