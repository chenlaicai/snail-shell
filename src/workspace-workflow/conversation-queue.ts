export class ConversationQueue {
  private readonly queues = new Map<string, Promise<void>>();

  enqueue<T>(conversationId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(conversationId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const queued = run.then(() => undefined, () => undefined);
    this.queues.set(conversationId, queued);
    return run.finally(() => {
      if (this.queues.get(conversationId) === queued) {
        this.queues.delete(conversationId);
      }
    });
  }
}
