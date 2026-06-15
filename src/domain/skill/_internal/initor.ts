import type { FileDataStore } from "@infra/file-data-store";
import type { Workspace } from "@domain/workspace/model";
import { FileSkillRepository } from "@domain/skill/_internal/repository";
import { SkillAdapter } from "@domain/skill/_internal/adapter";

/** 初始化 Skill 模块 */
export function init(fileDataStore: FileDataStore, workspaces: Workspace[]) {
  const repo = new FileSkillRepository(fileDataStore, workspaces);
  const adapter = new SkillAdapter(repo);
  return { repo, adapter };
}
