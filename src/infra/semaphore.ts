/**
 * Semaphore — 带计数的信号量
 *
 * 通用基础设施，不限定业务语义。
 * 用于限制某个资源的并发访问数（如 snail template 的最大并行调用数）。
 */

export class Semaphore {
  private held = new Map<string, number>();
  private waiters = new Map<string, Array<() => void>>();

  /**
   * @param maxHolders 每个 name 的最大持有者数，默认 1（互斥锁）
   */
  constructor(private maxHolders: number = 1) {}

  /**
   * 获取锁。满了则异步等待。
   * 返回 release 函数，调用方用 try-finally 保证释放。
   */
  async acquire(name: string): Promise<() => void> {
    const count = this.held.get(name) ?? 0;
    if (count < this.maxHolders) {
      this.held.set(name, count + 1);
      return () => this.release(name);
    }
    return new Promise<() => void>((resolve) => {
      const queue = this.waiters.get(name) ?? [];
      queue.push(() => resolve(() => this.release(name)));
      this.waiters.set(name, queue);
    });
  }

  /** 当前持有数 */
  activeCount(name: string): number {
    return this.held.get(name) ?? 0;
  }

  /** 等待队列长度 */
  waitingCount(name: string): number {
    return (this.waiters.get(name) ?? []).length;
  }

  private release(name: string): void {
    const queue = this.waiters.get(name);
    if (queue && queue.length > 0) {
      queue.shift()!();
    } else {
      const count = this.held.get(name) ?? 0;
      this.held.set(name, Math.max(0, count - 1));
    }
  }
}
