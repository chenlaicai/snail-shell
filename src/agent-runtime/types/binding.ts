/**
 * 运行时绑定类型
 *
 * 定义 Agent 运行时绑定和调用主体结构。
 */

/**
 * Template 运行时绑定：从 role→snail→template 解析出的运行时参数。
 */
export interface RuntimeBinding {
  templateId: string;
  runtime: string;
  model: string;
  contextProvider: "shell" | "agent";
  contextWindow?: number;
  invocationTimeoutMs?: number;
}

/**
 * 调用主体：每次 agent 调用前从当前运行态解析出的结构化对象。
 */
export interface InvocationSubject {
  workspaceId: string;
  issueId: string;
  stageId: string;
  conversationId: string;
  role: {
    key: string;
    name: string;
    description: string;
    rules: string[];
    isPrimary: boolean;
  };
  runtimeBinding: RuntimeBinding;
}
