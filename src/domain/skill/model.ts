/** Agent Skill 定义 */
export interface Skill {
  /** Skill 唯一标识，来自 frontmatter name */
  name: string;
  /** 描述 */
  description: string;
  /** 来源：platform 平台级，workspace 工作区级 */
  layer: "platform" | "workspace";
  /** markdown 正文 */
  content: string;
}
