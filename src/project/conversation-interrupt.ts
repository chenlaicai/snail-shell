export class ConversationInterruptRegistry {
  private readonly activeRuns = new Map<string, AbortController>();

  start(conversationId: string): AbortController {
    const controller = new AbortController();
    this.activeRuns.set(conversationId, controller);
    return controller;
  }

  finish(conversationId: string): void {
    this.activeRuns.delete(conversationId);
  }

  interrupt(conversationId: string): boolean {
    const controller = this.activeRuns.get(conversationId);
    if (!controller || controller.signal.aborted) return false;
    /**
     * 中断是对当前运行轮次的控制信号，不直接改数据库终态。
     * 终态必须由正在运行的消息协议在捕获 Abort 后写入，才能保证已流式事件、message_context 和
     * message_status_changed 实时事件按同一生命周期顺序落库与广播。
     */
    controller.abort();
    return true;
  }
}
