import type { SkillCapability } from "./spec";
import { listSkills } from "../../skill-center";

/**
 * 收集当前激活的 skill 列表。
 *
 * 历史上通过 prompt 的 skill_references 字段声明依赖，现已被移除。
 * 当前实现返回所有已注册的 skill——skill 是独立能力包，
 * 系统提示词在具体步骤中按需引用，不再通过声明式字段关联。
 */
export function collectActiveSkills(): SkillCapability[] {
  return listSkills().map((def) => ({
    name: def.name,
    description: def.description,
    filePath: def.filePath,
    directory: require("path").dirname(def.filePath),
    content: def.content,
  }));
}
