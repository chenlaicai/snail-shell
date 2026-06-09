/**
 * 配置类型
 *
 * 定义系统配置相关的类型。
 */

/** evolution 治理服务配置（config/evolution.json 的 schema）。 */
export interface EvolutionConfig {
  sop_id: string;
}

/** init.json 的 schema。FileConfigStore 和 snail-loader 共用此类型。 */
export interface SnailWorkspaceConfig {
  name: string;
  summary?: string;
  guard_profile?: Record<string, unknown> | null;
}
