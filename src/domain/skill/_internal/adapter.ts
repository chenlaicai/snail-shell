import type { Skill } from "@domain/skill/model";
import type { SkillPort } from "@domain/skill/port";
import type { SkillRepository } from "./repository";

/**
 * Skill 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class SkillAdapter implements SkillPort {
  constructor(private repo: SkillRepository) {}

  list(): Skill[] {
    return this.repo.list();
  }

  findByName(name: string): Skill | undefined {
    return this.repo.findByName(name);
  }
}
