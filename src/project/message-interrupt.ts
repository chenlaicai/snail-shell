export class MessageInterruptRegistry {
  private readonly activeMessages = new Map<number, AbortController>();

  createRunController(): AbortController {
    return new AbortController();
  }

  bindMessage(messageId: number, controller: AbortController): void {
    this.activeMessages.set(messageId, controller);
  }

  finishMessage(messageId: number): void {
    this.activeMessages.delete(messageId);
  }

  interrupt(messageId: number): boolean {
    const controller = this.activeMessages.get(messageId);
    if (!controller || controller.signal.aborted) return false;
    /**
     * 中断目标必须是具体 assistant message，而不是整个 conversation。
     * 用户看到、操作和追溯的都是某条正在流式生成的消息；按 message 绑定 AbortController 可以避免
     * 未来同一会话内多个运行消息或后续恢复操作互相误伤。
     */
    controller.abort();
    return true;
  }
}
