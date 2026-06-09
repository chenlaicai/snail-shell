/**
 * Skill 模块公开类型
 *
 * 定义 Skill 注册和查询的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Registry 接口访问 Skill
 */

/**
 * Skill 定义
 */
export interface SkillDefinition {
  /** Skill ID */
  id: string;
  /** Skill 名称 */
  name: string;
  **Skill 描述
  description: string;
  **Skill 路径
  path: string;
  **Skill 内容
  content: string;
}
