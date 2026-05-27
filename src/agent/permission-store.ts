import type { ToolPermissionRequest } from "./interface";

export interface PendingApproval {
  conversationId: string;
  messageId: number;
  request: ToolPermissionRequest;
  /** 触发本次 agent 调用的原始用户消息 id，用于 retry 时查找。 */
  originalUserMessageId: number;
  /** 触发本次 agent 调用的 role 名，用于 retry 时重新路由。 */
  originalRoleName: string;
  createdAt: string;
}

class PermissionStore {
  private store = new Map<string, PendingApproval>();

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
}

/** 模块级单例，pending approval 请求的生命周期内有效。 */
export const permissionStore = new PermissionStore();
