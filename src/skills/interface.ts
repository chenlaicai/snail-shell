export interface SkillContext {
  conversationId: string;
  sessionManager: import("../session/manager").SessionManager;
}

export interface SkillResult {
  success: boolean;
  message: string;
  data?: any;
}

export interface Skill {
  name: string;
  description: string;
  execute(context: SkillContext, args: Record<string, any>): Promise<SkillResult>;
}
