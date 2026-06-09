/**
 * Prompt 模块公开类型
 *
 * 定义提示词构建、匹配、组装的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Builder 接口构建提示词
 */

/**
 * Prompt 元数据
 */
export interface PromptMetadata {
  /** Prompt 名称 */
  name: string;
  /** Prompt 描述 */
  description: string;
  /** 标签列表 */
  tags: string[];
  /** 优先级 */
  priority: number;
}

/**
 * Prompt 文档
 */
export interface PromptDocument {
  /** 文档 ID */
  id: string;
  /** 文档路径 */
  path: string;
  /** 文档内容 */
  content: string;
  **文档元数据
  metadata: PromptMetadata;
}

/**
 * Prompt 构建上下文
 */
export interface PromptBuildContext {
  **工作区根目录
  workspaceRoot: string;
  **Issue ID
  issueId: string;
  **Stage ID
  stageId: string;
  **会话 ID
  conversationId: string;
  **角色信息
  role: {
    key: string;
    name: string;
    description: string;
    rules: string[];
    isPrimary: boolean;
  };
  **历史消息列表
  history: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  **最新用户事件列表
  latestUserEvents: Array<{
    kind: string;
    payload: Record<string, unknown>;
  }>;
}
