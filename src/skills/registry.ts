import { Skill, SkillContext, SkillResult } from "./interface";
import { CreateRequirementSkill } from "./create-requirement";

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor() {
    // Register all skills
    this.register(new CreateRequirementSkill());
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  listSkills(): { name: string; description: string }[] {
    return Array.from(this.skills.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
  }

  async execute(
    name: string,
    context: SkillContext,
    args: Record<string, any>
  ): Promise<SkillResult> {
    const skill = this.skills.get(name);
    if (!skill) {
      return {
        success: false,
        message: `Skill not found: ${name}`,
      };
    }

    try {
      return await skill.execute(context, args);
    } catch (error: any) {
      return {
        success: false,
        message: `Error executing skill ${name}: ${error.message}`,
      };
    }
  }
}
