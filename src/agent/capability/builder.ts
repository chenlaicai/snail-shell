import type {
  AgentCapability,
  PromptCapability,
  SkillCapability,
} from "./spec";
import type { SkillDefinition } from "../../skill-center";
import { listSkills } from "../../skill-center";
import type { PromptDocument, PromptSkillReference, FrameDocument, FrameMatchContext } from "../../prompt-center";
import { renderFrame } from "../../prompt-center";
import path from "path";

// ──── Builder 输入 ────

export interface CapabilityBuildInput {
  /** Frame 文档（F-01、F-02 等） */
  frame: FrameDocument;
  /** Frame 的条件匹配上下文 */
  frameContext: FrameMatchContext;
  /** Frame 的模板变量 */
  variables: Record<string, string>;
  /** 所有可用的 prompt 文档 */
  prompts: PromptDocument[];
  /** 当前 frame 引用的 prompt ID 集合（从 frame.content 解析） */
  referencedPromptIds: string[];
}

// ──── 构建函数 ────

/**
 * 从上下文构建 AgentCapability。
 *
 * 这是协议层的核心函数。它接收所有可用能力的声明信息，
 * 产生一个结构化的 AgentCapability 对象。
 *
 * 能力发现策略：
 * 1. systemPrompt：由 Frame Assembler 生成（保持现有行为）
 * 2. prompts：从 frame 引用中解析 + 从 skills frontmatter 反查（被哪些 prompt 引用然后激活）
 * 3. skills：从 prompt 的 skill_references 中提取
 */
export function buildAgentCapability(input: CapabilityBuildInput): AgentCapability {
  const systemPrompt = renderFrame(input.frame, input.frameContext, input.variables);

  // 收集 frame 引用的（且未因条件过滤而移除的）prompt
  const activePrompts = collectActivePrompts(input.referencedPromptIds, input.prompts, systemPrompt);

  // 从 active prompts 的 skill_references 收集激活的 skills
  const allSkills = listSkills();
  const activeSkills = collectActiveSkills(activePrompts, allSkills, input.prompts);

  return {
    systemPrompt,
    prompts: activePrompts,
    skills: activeSkills,
  };
}

// ──── Prompt 收集 ────

/**
 * 收集当前上下文激活的 prompt 模块。
 *
 * 策略：frame 引用的 prompt ID + 实际出现在 systemPrompt 中的 prompt 内容
 * （通过 prompt 的特征标题行匹配，因为条件过滤可能移除了某些 prompt）。
 */
function collectActivePrompts(
  referencedPromptIds: string[],
  allPrompts: PromptDocument[],
  renderedSystemPrompt: string,
): PromptCapability[] {
  return referencedPromptIds
    .map((id) => allPrompts.find((p) => p.id === id))
    .filter((p): p is PromptDocument => !!p)
    // 过滤：只在确实出现在 systemPrompt 中的 prompt 才算激活
    // 因为 {{#when:...}} 条件可能移除了某些 prompt
    .filter((p) => isPromptInSystemPrompt(p, renderedSystemPrompt))
    .map((p) => ({
      id: p.id,
      title: p.title,
      mode: p.id.startsWith("B-") ? "base" : "scenario",
    }));
}

/**
 * 检查 prompt 的内容是否实际出现在 systemPrompt 中。
 * 通过 prompt 标题行做特征匹配（每个 prompt 文档有唯一的 ## 标题）。
 */
function isPromptInSystemPrompt(prompt: PromptDocument, systemPrompt: string): boolean {
  // 从 prompt content 的第一行标题提取匹配特征
  const titleMatch = prompt.content.match(/^##\s+([^\n]+)/m);
  if (!titleMatch) return true; // 无法匹配时保守包含
  const titleText = titleMatch[1].trim();
  // 标题文本在 systemPrompt 中出现即认为激活
  return systemPrompt.includes(titleText);
}

// ──── Skill 收集 ────

/**
 * 从 active prompts 的 skill_references 收集当前激活的 skill。
 *
 * 一个 skill 被激活的条件：有至少一个 active prompt 在其 skill_references 中引用了该 skill。
 */
function collectActiveSkills(
  activePrompts: PromptCapability[],
  allSkills: SkillDefinition[],
  allPrompts: PromptDocument[],
): SkillCapability[] {
  // 收集所有 active prompt 引用的所有 skill
  const skillRefs: Array<{ promptId: string; ref: PromptSkillReference }> = [];
  for (const cap of activePrompts) {
    const promptDoc = allPrompts.find((p) => p.id === cap.id);
    if (promptDoc?.skill_references) {
      for (const ref of promptDoc.skill_references) {
        skillRefs.push({ promptId: cap.id, ref });
      }
    }
  }

  // 按 skill id 去重（多个 prompt 可能引用同一个 skill）
  const seenSkills = new Set<string>();

  return skillRefs
    .filter(({ ref }) => {
      if (seenSkills.has(ref.id)) return false;
      seenSkills.add(ref.id);
      return true;
    })
    .map(({ ref }) => {
      const skillDef = allSkills.find((s) => s.name === ref.id);
      if (!skillDef) return null;
      return {
        name: skillDef.name,
        description: skillDef.description,
        filePath: skillDef.filePath,
        directory: path.dirname(skillDef.filePath),
        mode: ref.mode,
        reason: ref.reason,
        content: skillDef.content,
        title: skillDef.title,
      } as SkillCapability;
    })
    .filter((s): s is SkillCapability => !!s);
}
