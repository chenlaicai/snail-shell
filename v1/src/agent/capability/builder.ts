import path from "path";
import type { SkillCapability } from "./spec";
import type { SkillDefinition } from "../../skill-center/registry";
import { listSkills, listSkillsWithWorkspace } from "../../skill-center";

/**
 * 收集当前激活的 skill 列表。
 *
 * 历史上通过 prompt 的 skill_references 字段声明依赖，现已被移除。
 * 当前实现返回所有已注册的 skill——skill 是独立能力包，
 * 系统提示词在具体步骤中按需引用，不再通过声明式字段关联。
 *
 * @param workspaceSkills 工作区级 skill 列表，由调用方通过 `loadWorkspaceContext` 统一加载后传入。
 *   传入时与全局 skill 合并，同名报错（skill name 全局唯一）。传空数组或不传时仅返回全局 skill。
 */
export function collectActiveSkills(workspaceSkills?: SkillDefinition[]): SkillCapability[] {
  const defs = workspaceSkills ? listSkillsWithWorkspace(workspaceSkills) : listSkills();
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    filePath: def.filePath,
    directory: path.dirname(def.filePath),
    content: def.content,
    source: def.source,
  }));
}
