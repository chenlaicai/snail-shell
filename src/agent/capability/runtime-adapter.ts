import type { AgentCapability } from "./spec";

/**
 * 结合 capability 构建 runtime-specific 的系统提示词增强。
 *
 * 当 capability.skills 包含 "required" skill 时：
 * - 将其完整 SKILL.md 内容嵌入 system prompt，避免模型再读取文件
 * - 为每个 skill 添加 `[CAPABILITY-SKILL:name]` 标记用于能力追溯
 *
 * 当 capability 不可用或无 required skills 时：直接返回原始 system prompt。
 */
export function buildSystemPromptFromCapability(
  baseSystemPrompt: string,
  capability?: AgentCapability,
): string {
  if (!capability || capability.skills.length === 0) {
    return baseSystemPrompt;
  }

  const requiredSkills = capability.skills.filter((s) => s.mode === "required");
  if (requiredSkills.length === 0) {
    return baseSystemPrompt;
  }

  // 构建 structured skill injection 段
  const skillBlocks = requiredSkills.map((skill) => {
    return [
      `### ${skill.title}`,
      `[CAPABILITY-SKILL:${skill.name}] 以下为该 skill 的完整操作协议。必须严格遵守其中的步骤和命令格式。`,
      "",
      // 去掉 SKILL.md 的一级标题（避免与二级标题冲突）
      skill.content.replace(/^#\s+.+\n+/m, ""),
    ].join("\n");
  });

  const capabilitySection = [
    "",
    "---",
    "## 能力注入 (Capability Protocol)",
    "",
    `以下 ${requiredSkills.length} 个 required skill 已按 Agent Capability 协议直接注入，无需再读取文件：`,
    "",
    ...skillBlocks,
    "",
    "---",
    "",
  ].join("\n");

  // 将 capability section 追加到 system prompt 末尾（不影响现有的 prompt 结构）
  return baseSystemPrompt.trimEnd() + "\n" + capabilitySection;
}
