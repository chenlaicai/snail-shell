export class StageQueue {
  private chains = new Map<string, Promise<void>>();

  enqueue(stageId: string, task: () => Promise<void>): void {
    const previous = this.chains.get(stageId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .catch(console.error)
      .finally(() => {
        if (this.chains.get(stageId) === next) {
          this.chains.delete(stageId);
        }
      });
    this.chains.set(stageId, next);
  }
}
