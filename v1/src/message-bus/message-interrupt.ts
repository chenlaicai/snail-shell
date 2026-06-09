export class MessageInterruptRegistry {
  private readonly activeMessages = new Map<string, AbortController>();
  private readonly stopPromises = new Map<string, Promise<void>>();

  createRunController(): AbortController {
    return new AbortController();
  }

  bindMessage(conversationId: string, messageId: number, controller: AbortController): void {
    this.activeMessages.set(this.messageKey(conversationId, messageId), controller);
  }

  /**
   * agent 启动前注册一个 deferred Promise，agent 完成后 resolve。
   * 这样 shutdown 的 waitForAllStopped 在 agent 运行期间就能等到它。
   */
  registerStopPromise(conversationId: string, messageId: number, stopPromise: Promise<void>): void {
    this.stopPromises.set(this.messageKey(conversationId, messageId), stopPromise);
  }

  finishMessage(conversationId: string, messageId: number): void {
    const key = this.messageKey(conversationId, messageId);
    this.activeMessages.delete(key);
    this.stopPromises.delete(key);
  }

  interrupt(conversationId: string, messageId: number): boolean {
    const controller = this.activeMessages.get(this.messageKey(conversationId, messageId));
    if (!controller || controller.signal.aborted) return false;
    /**
     * 中断目标必须由 conversation 与 assistant message 共同限定。
     * 知识治理和工作区 conversation 允许复用相同的局部 message id；只按裸 id 绑定运行任务会让
     * 一个 conversation 的停止动作误伤另一个 conversation 中同号的流式消息。
     */
    controller.abort();
    return true;
  }

  /** 中断所有活跃的 agent 运行任务，用于服务关闭时清理残留子进程。 */
  interruptAll(): void {
    for (const controller of this.activeMessages.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    this.activeMessages.clear();
  }

  /**
   * 等待所有已注册的 stopPromise 完成。
   * stopPromise 在 agent 启动前注册、agent 完成后 resolve，因此 shutdown 时
   * 即使 agent 仍在运行，waitForAllStopped 也能等到它退出。
   */
  async waitForAllStopped(): Promise<void> {
    await Promise.allSettled(this.stopPromises.values());
    this.stopPromises.clear();
  }

  private messageKey(conversationId: string, messageId: number): string {
    return `${conversationId}:${messageId}`;
  }
}
