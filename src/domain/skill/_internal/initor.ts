import type { FileSystem } from "@infra/file-system";
import { FileSkillRepository } from "./repository";
import { SkillAdapter } from "./adapter";

/** 初始化 Skill 模块 */
export function init(fs: FileSystem, repoRoot: string, workspacePaths: string[]) {
  const repo = new FileSkillRepository(fs, repoRoot, workspacePaths);
  const adapter = new SkillAdapter(repo);
  return { repo, adapter };
}
