import { Skill, SkillContext, SkillResult } from "./interface";

export class CreateRequirementSkill implements Skill {
  name = "create-requirement";
  description = "创建一个新的需求，用于管理项目任务";

  async execute(context: SkillContext, args: Record<string, any>): Promise<SkillResult> {
    const { title, description } = args;

    if (!title || typeof title !== "string") {
      return {
        success: false,
        message: "title is required and must be a string",
      };
    }

    try {
      const requirement = context.sessionManager.createRequirement(
        context.sessionId,
        title,
        description
      );

      return {
        success: true,
        message: `Requirement created successfully with ID: ${requirement.id}`,
        data: requirement,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to create requirement: ${error.message}`,
      };
    }
  }
}
