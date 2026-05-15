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

export class SnailRegistry {
  private roles = new Map<string, RoleDefinition>();
  private stageRoles = new Map<string, string[]>();
  private store: RoleDefinitionStore;

  constructor(store: RoleDefinitionStore) {
    this.store = store;
    this.loadFromStore();
  }

  /** 从 store 重新加载所有 role definitions（用于新建项目后刷新）。 */
  reloadFromStore(): void {
    this.roles.clear();
    this.stageRoles.clear();
    this.loadFromStore();
  }

  private loadFromStore(): void {
    for (const rd of this.store.listAllRoleDefinitions()) {
      this.roles.set(rd.name, rd);
      const stageDef = this.store.getStageDefinition(rd.stage_definition_id);
      const stageKey = stageDef ? `${rd.project_id}:${stageDef.key}` : `${rd.project_id}:${rd.stage_definition_id}`;
      const existing = this.stageRoles.get(stageKey) ?? [];
      if (!existing.includes(rd.name)) {
        existing.push(rd.name);
      }
      this.stageRoles.set(stageKey, existing);
    }
  }

  get(name: string): RoleDefinition | undefined {
    return this.roles.get(name);
  }

  has(name: string): boolean {
    return this.roles.has(name);
  }

  list(): RoleDefinition[] {
    return Array.from(this.roles.values());
  }

  listByStageType(projectId: string, stageType: string): RoleDefinition[] {
    const key = `${projectId}:${stageType}`;
    return (this.stageRoles.get(key) ?? []).map((name) => this.roles.get(name)).filter(Boolean) as RoleDefinition[];
  }

  getPrimaryForStageType(projectId: string, stageType: string): RoleDefinition {
    const roles = this.listByStageType(projectId, stageType);
    const primary = roles.find((r) => r.is_primary === 1) ?? roles[0];
    if (!primary) {
      throw new Error(`No roles configured for stage type: ${stageType} in project ${projectId}`);
    }
    return primary;
  }

  /** 获取角色关联的 snail den template ID。 */
  getSnailTemplateId(name: string): string | null {
    return this.roles.get(name)?.snail_template_id ?? null;
  }
}
