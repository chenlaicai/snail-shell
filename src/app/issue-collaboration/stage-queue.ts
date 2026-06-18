import { getLogger } from "@infra/logger";

const log = getLogger({ module: "collaboration" });

export class StageQueue {
  private chains = new Map<string, Promise<void>>();

  enqueue(stageId: string, task: () => Promise<void>): void {
    const previous = this.chains.get(stageId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .catch((err) => log.error({ err, stageId }))
      .finally(() => {
        if (this.chains.get(stageId) === next) {
          this.chains.delete(stageId);
        }
      });
    this.chains.set(stageId, next);
  }
}
