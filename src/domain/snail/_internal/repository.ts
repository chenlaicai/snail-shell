import type { Snail } from "@domain/snail/model";
import type { FileDataStore } from "@infra/file-data-store";

/** Snail 持久层接口 */
export interface SnailRepository {
  /** 列出所有 snail */
  list(): Snail[];

  /** 按 key 查找 */
  findByKey(key: string): Snail | undefined;
}

/**
 * Snail 文件存储实现。
 * 从 data/file/snails.json 读取配置，启动时加载到内存。
 */
export class FileSnailRepository implements SnailRepository {
  private static readonly FILE = "snails.json";

  private snails = new Map<string, Snail>();

  constructor(private dataStore: FileDataStore) {
    this.loadSnails();
  }

  list(): Snail[] {
    return [...this.snails.values()];
  }

  findByKey(key: string): Snail | undefined {
    return this.snails.get(key);
  }

  /** 从 snails.json 加载配置到缓存 */
  private loadSnails(): void {
    const raw = this.dataStore.readJson<{ snails: Snail[] }>(FileSnailRepository.FILE);
    if (!raw?.snails) return;

    for (const snail of raw.snails) {
      if (!snail.key) throw new Error("Invalid snails.json: snail.key is required");
      if (this.snails.has(snail.key)) throw new Error(`Invalid snails.json: duplicate snail key ${snail.key}`);
      this.snails.set(snail.key, snail);
    }
  }
}
