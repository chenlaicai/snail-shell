import type { Workspace } from "@domain/workspace/model";
import type { Skill } from "@domain/skill/model";

/** Skill 端口定义 */
export interface SkillPort {
  /** 页面展示用，列出所有 skills */
  list(): Skill[];

  /** 获取指定 workspace 的 skills（平台 + 该 workspace） */
  findByWorkspace(workspace: Workspace): Skill[];
}
