/** 原则性 Prompt 文档 */
export interface PromptDocument {
  /** 文档唯一标识，来自 frontmatter id */
  id: string;
  /** 显示标题 */
  title: string;
  /** 稳定性：static 不变，dynamic 每次渲染 */
  stability: "static" | "dynamic";
  /** 来源层：platform 平台级，workspace 工作区级 */
  layer: "platform" | "workspace";
  /** 优先级，数字越小越靠前 */
  priority: number;
  /** 条件匹配 */
  when: PromptWhen | null;
  /** markdown 正文 */
  content: string;
}

/** 条件匹配规则 */
export interface PromptWhen {
  /** 匹配的 runtime 列表 */
  runtimes?: string[];
  /** 匹配的 stage 类型列表 */
  stage_types?: string[];
  /** 匹配的角色列表 */
  roles?: string[];
  /** 匹配的会话类型列表 */
  conversation_kinds?: string[];
}
