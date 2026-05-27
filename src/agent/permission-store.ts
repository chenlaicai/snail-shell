import type { ToolPermissionRequest } from "./interface";

export interface PendingApproval {
  conversationId: string;
  messageId: number;
  request: ToolPermissionRequest;
  /** 触发本次 agent 调用的原始消息 id，用于 retry 时查找。 */
  originalUserMessageId: number;
  /** 被审批的目标 agent role 名。 */
  originalRoleName: string;
  /** 触发本次 agent 调用的消息发送方 role，用于 retry 时保持正确的路由语义。 */
  originalFromRole: string;
  createdAt: string;
}

class PermissionStore {
  private store = new Map<string, PendingApproval>();
  /** 按 projectRoot 暂存的临时 extraAllow 模式，供 retry 时 invokeMessage 消费后自动清除。 */
  private extraAllowByProject = new Map<string, string[]>();

  private key(conversationId: string, messageId: number): string {
    return `${conversationId}:${messageId}`;
  }

  set(approval: PendingApproval): void {
    this.store.set(this.key(approval.conversationId, approval.messageId), approval);
  }

  get(conversationId: string, messageId: number): PendingApproval | undefined {
    return this.store.get(this.key(conversationId, messageId));
  }

  delete(conversationId: string, messageId: number): boolean {
    return this.store.delete(this.key(conversationId, messageId));
  }

  has(conversationId: string, messageId: number): boolean {
    return this.store.has(this.key(conversationId, messageId));
  }

  setExtraAllow(projectRoot: string, patterns: string[]): void {
    const existing = this.extraAllowByProject.get(projectRoot) ?? [];
    this.extraAllowByProject.set(projectRoot, [...existing, ...patterns]);
  }

  /** 获取并清除指定 projectRoot 的临时 extraAllow。invokeMessage 调用后自动消费。 */
  takeExtraAllow(projectRoot: string): string[] {
    const patterns = this.extraAllowByProject.get(projectRoot) ?? [];
    this.extraAllowByProject.delete(projectRoot);
    return patterns;
  }
}

/** 模块级单例，pending approval 请求的生命周期内有效。 */
export const permissionStore = new PermissionStore();
