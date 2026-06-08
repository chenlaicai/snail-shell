/**
 * Skill 域公开 API — 接口层。
 */

import type { SkillDefinition } from '@/skill/types.js';

/** Skill 服务接口 */
export interface SkillService {
  /** 列出平台级 skill */
  listPlatform(): SkillDefinition[];

  /** 列出工作区级 skill */
  listWorkspace(): SkillDefinition[];

  /** 合并平台级 + 工作区级 skill（同名冲突报错） */
  listAll(): SkillDefinition[];

  /** 按名称获取 skill */
  getSkill(name: string): SkillDefinition | undefined;
}
