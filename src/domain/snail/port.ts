import type {
  SnailTemplate,
  SnailRuntimeInstance,
  SnailAgentSession,
  CreateSnailAgentSessionInput,
} from "./model";

/** Snail 端口定义 */
export interface SnailPort {
  /** 列出所有模板 */
  listTemplates(): SnailTemplate[];

  /** 按 ID 查找模板 */
  findTemplateById(id: string): SnailTemplate | undefined;

  /** 获取运行时实例（解析模板为可调用的运行时） */
  getSnailRuntime(templateId: string): SnailRuntimeInstance | undefined;

  /** 查找当前会话 */
  findCurrentSession(conversationId: string, roleName: string): SnailAgentSession | undefined;

  /** 创建会话 */
  createSession(input: CreateSnailAgentSessionInput): SnailAgentSession;

  /** 更新会话的外部 session ID */
  updateSessionExternalId(sessionId: string, externalSessionId: string): void;
}
