import type { Skill } from "./model";

/** Skill 端口定义 */
export interface SkillPort {
  /** 列出所有已加载的 skill */
  list(): Skill[];

  /** 按 name 查找 */
  findByName(name: string): Skill | undefined;
}
