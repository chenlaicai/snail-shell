/**
 * SOP Repository 接口
 *
 * 定义 SOP 模板、阶段定义、转移规则的持久化操作接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口访问数据库
 */

import type {
  Sop,
  SopStageDefinition,
  SopStageRoleDefinition,
  SopTransition,
  CreateSopInput,
  CreateSopStageDefinitionInput,
  CreateSopStageRoleDefinitionInput,
  CreateSopTransitionInput,
  SopSource,
} from "../types";

/**
 * SOP Repository 接口
 *
 * 定义 SOP 模板、阶段定义、转移规则的持久化操作。
 */
export interface SopRepository {
  // ═══ Sop CRUD ═══

  /**
   * 获取 SOP
   * @param id SOP ID
   * @returns SOP 实体，不存在返回 null
   */
  getSop(id: string): Promise<Sop | null>;

  /**
   * 根据标识符获取 SOP
   * @param source SOP 来源
   * @param key SOP 标识符
   * @returns SOP 实体，不存在返回 null
   */
  getSopByKey(source: SopSource, key: string): Promise<Sop | null>;

  /**
   * 获取 SOP 列表
   * @param source SOP 来源过滤
   * @returns SOP 列表
   */
  listSops(source?: SopSource): Promise<Sop[]>;

  /**
   * 保存 SOP
   * @param sop SOP 实体
   */
  saveSop(sop: CreateSopInput): Promise<Sop>;

  /**
   * 删除 SOP
   * @param id SOP ID
   */
  deleteSop(id: string): Promise<void>;

  // ═══ SopStageDefinition CRUD ═══

  /**
   * 获取 SOP Stage 定义
   * @param id Stage 定义 ID
   * @returns Stage 定义实体，不存在返回 null
   */
  getSopStageDefinition(id: string): Promise<SopStageDefinition | null>;

  /**
   * 获取 SOP 的 Stage 定义列表
   * @param sopId SOP ID
   * @returns Stage 定义列表
   */
  listSopStageDefinitions(sopId: string): Promise<SopStageDefinition[]>;

  /**
   * 保存 SOP Stage 定义
   * @param definition Stage 定义实体
   */
  saveSopStageDefinition(definition: CreateSopStageDefinitionInput): Promise<SopStageDefinition>;

  // ═══ SopStageRoleDefinition CRUD ═══

  /**
   * 获取 SOP Stage 角色定义
   * @param id 角色定义 ID
   * @returns 角色定义实体，不存在返回 null
   */
  getSopStageRoleDefinition(id: string): Promise<SopStageRoleDefinition | null>;

  /**
   * 获取 Stage 定义的角色定义列表
   * @param stageDefinitionId Stage 定义 ID
   * @returns 角色定义列表
   */
  listSopStageRoleDefinitions(stageDefinitionId: string): Promise<SopStageRoleDefinition[]>;

  /**
   * 保存 SOP Stage 角色定义
   * @param definition 角色定义实体
   */
  saveSopStageRoleDefinition(definition: CreateSopStageRoleDefinitionInput): Promise<SopStageRoleDefinition>;

  // ═══ SopTransition CRUD ═══

  /**
   * 获取 SOP 转移列表
   * @param sopId SOP ID
   * @returns 转移列表
   */
  getSopTransitions(sopId: string): Promise<SopTransition[]>;

  /**
   * 获取从指定 Stage 出发的转移列表
   * @param sopId SOP ID
   * @param fromStageKey 源 Stage 标识符
   * @returns 转移列表
   */
  getForwardTransitions(sopId: string, fromStageKey: string): Promise<SopTransition[]>;

  /**
   * 保存 SOP 转移
   * @param transition 转移实体
   */
  saveSopTransition(transition: CreateSopTransitionInput): Promise<SopTransition>;

  // ═══ 查询方法 ═══

  /**
   * 验证转移是否有效
   * @param sopId SOP ID
   * @param fromStageKey 源 Stage 标识符
   * @param toStageKey 目标 Stage 标识符
   * @returns 转移实体，无效转移返回 null
   */
  validateTransition(sopId: string, fromStageKey: string, toStageKey: string): Promise<SopTransition | null>;

  /**
   * 获取 SOP 的 Stage 定义列表（包含角色定义）
   * @param sopId SOP ID
   * @returns Stage 定义列表（包含角色定义）
   */
  listSopStageDefinitionsWithRoles(sopId: string): Promise<Array<SopStageDefinition & { roles: SopStageRoleDefinition[] }>>;
}
