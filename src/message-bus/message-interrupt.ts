export class MessageInterruptRegistry {
  private readonly activeMessages = new Map<string, AbortController>();

  createRunController(): AbortController {
    return new AbortController();
  }

  bindMessage(conversationId: string, messageId: number, controller: AbortController): void {
    this.activeMessages.set(this.messageKey(conversationId, messageId), controller);
  }

  finishMessage(conversationId: string, messageId: number): void {
    this.activeMessages.delete(this.messageKey(conversationId, messageId));
  }

  interrupt(conversationId: string, messageId: number): boolean {
    const controller = this.activeMessages.get(this.messageKey(conversationId, messageId));
    if (!controller || controller.signal.aborted) return false;
    /**
     * 中断目标必须由 conversation 与 assistant message 共同限定。
     * 知识治理和项目 conversation 允许复用相同的局部 message id；只按裸 id 绑定运行任务会让
     * 一个 conversation 的停止动作误伤另一个 conversation 中同号的流式消息。
     */
    controller.abort();
    return true;
  }

  private messageKey(conversationId: string, messageId: number): string {
    return `${conversationId}:${messageId}`;
  }
}
