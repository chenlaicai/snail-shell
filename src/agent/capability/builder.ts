import type { SkillCapability } from "./spec";
import { listSkills } from "../../skill-center";
import type { PromptDocument } from "../../prompt-center";
import path from "path";

/**
 * 从 prompt 的 skill_references 中收集当前激活的 skill。
 *
 * 这是 capability/builder 的唯一切入点——
 * systemPrompt 的组装在 prompt-center/builder 中完成，
 * 此处只负责把 Snail Shell 内部的 prompt→skill 引用关系
 * 翻译为 ACS 的 SkillCapability 列表。
 */
export function collectActiveSkills(referencedPromptIds: string[], allPrompts: PromptDocument[]): SkillCapability[] {
  const allSkills = listSkills();

  // 收集所有被引用的 prompt 所声明的 skill_references
  const skillRefs: Array<{ promptId: string; skillId: string }> = [];
  for (const promptId of referencedPromptIds) {
    const promptDoc = allPrompts.find((p) => p.id === promptId);
    if (promptDoc?.skill_references) {
      for (const ref of promptDoc.skill_references) {
        skillRefs.push({ promptId, skillId: ref.id });
      }
    }
  }

  // 按 skill id 去重
  const seen = new Set<string>();
  return skillRefs
    .filter(({ skillId }) => {
      if (seen.has(skillId)) return false;
      seen.add(skillId);
      return true;
    })
    .map(({ skillId }) => {
      const def = allSkills.find((s) => s.name === skillId);
      if (!def) return null;
      return {
        name: def.name,
        description: def.description,
        filePath: def.filePath,
        directory: path.dirname(def.filePath),
        content: def.content,
      } satisfies SkillCapability;
    })
    .filter((s): s is SkillCapability => s !== null);
}
