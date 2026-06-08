/**
 * Skill 域公开类型。
 *
 * Skill 是系统教给 agent 的领域能力（markdown 文档 + YAML frontmatter）。
 */

/** Skill 定义 */
export interface SkillDefinition {
  /** skill 唯一标识符（来自 frontmatter 或目录名） */
  name: string;
  /** skill 功能描述（来自 frontmatter） */
  description: string;
  /** SKILL.md 文件绝对路径 */
  filePath: string;
  /** SKILL.md 所在目录绝对路径 */
  directory: string;
  /** markdown 正文（frontmatter 之后的内容） */
  content: string;
  /** skill 来源：platform 为平台级，workspace 为工作区级 */
  source: 'platform' | 'workspace';
}
