/**
 * Skill Registry 接口
 *
 * 定义 Skill 注册表的接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口访问 Skill
 */

import type { SkillDefinition } from "../types";

/**
 * Skill Registry 接口
 *
 * 定义 Skill 注册表的操作。
 */
export interface SkillRegistry {
  /**
   * 注册 Skill
   * @param skill Skill 定义
   */
  registerSkill(skill: SkillDefinition): void;

  /**
   * 获取 Skill
   * @param id Skill ID
   * @returns Skill 定义，不存在返回 null
   */
  getSkill(id: string): SkillDefinition | null;

  /**
   * 获取所有 Skill
   * @returns Skill 定义列表
   */
  listSkills(): SkillDefinition[];
}
