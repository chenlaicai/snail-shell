import type { Snail, SnailInstance } from "@domain/snail/model";
import type { FileDataStore } from "@infra/file-data-store";
import type { SQLiteDatabase } from "@infra/database";

/** Snail 持久层接口 */
export interface SnailRepository {
  /** 列出所有 snail */
  list(): Snail[];

  /** 按 key 查找 */
  findByKey(key: string): Snail | undefined;

  /** 创建 snail 配置 */
  create(snail: Snail): void;

  /** 更新 snail 配置 */
  update(key: string, snail: Omit<Snail, 'key'>): void;

  /** 删除 snail 配置 */
  delete(key: string): void;

  /** 按实例 ID 查找 snail 运行实例 */
  findInstanceById(id: string): SnailInstance | undefined;

  /** 创建 snail 运行实例 */
  createInstance(instance: SnailInstance): void;

  /** 更新 snail 运行实例的 agent session 链 */
  updateInstanceSessionIds(id: string, sessionIds: string[]): void;
}

const SNAIL_SCHEMA = `
CREATE TABLE IF NOT EXISTS snail_instance (
  id TEXT PRIMARY KEY,
  snail_key TEXT NOT NULL,
  session_ids TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

type SnailInstanceRow = {
  id: string;
  snail_key: string;
  session_ids: string;
  created_at: string;
};

/**
 * Snail 文件配置 + SQLite 实例存储实现。
 * Snail 配置从 data/file/snails.json 读取；调用实例持久化到 SQLite。
 */
export class FileSnailRepository implements SnailRepository {
  private static readonly FILE = "snails.json";

  private snails = new Map<string, Snail>();

  constructor(private dataStore: FileDataStore, private db: SQLiteDatabase) {
    this.db.initSchema(SNAIL_SCHEMA);
    this.loadSnails();
  }

  list(): Snail[] {
    return [...this.snails.values()];
  }

  findByKey(key: string): Snail | undefined {
    return this.snails.get(key);
  }

  create(snail: Snail): void {
    if (this.snails.has(snail.key)) {
      throw new Error(`Snail with key "${snail.key}" already exists`);
    }
    this.snails.set(snail.key, snail);
    this.saveSnails();
  }

  update(key: string, snail: Omit<Snail, 'key'>): void {
    if (!this.snails.has(key)) {
      throw new Error(`Snail with key "${key}" not found`);
    }
    this.snails.set(key, { key, ...snail });
    this.saveSnails();
  }

  delete(key: string): void {
    if (!this.snails.has(key)) {
      throw new Error(`Snail with key "${key}" not found`);
    }
    this.snails.delete(key);
    this.saveSnails();
  }

  findInstanceById(id: string): SnailInstance | undefined {
    const row = this.db.get<SnailInstanceRow>(`SELECT * FROM snail_instance WHERE id = ?`, [id]);
    return row ? mapInstance(row) : undefined;
  }

  createInstance(instance: SnailInstance): void {
    this.db.run(
      `INSERT INTO snail_instance (id, snail_key, session_ids, created_at)
       VALUES (?, ?, ?, ?)`,
      [instance.id, instance.snail_key, JSON.stringify(instance.session_ids), instance.created_at],
    );
  }

  updateInstanceSessionIds(id: string, sessionIds: string[]): void {
    this.db.run(
      `UPDATE snail_instance SET session_ids = ? WHERE id = ?`,
      [JSON.stringify(sessionIds), id],
    );
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

  /** 将缓存中的配置持久化到 snails.json */
  private saveSnails(): void {
    const snails = [...this.snails.values()];
    this.dataStore.writeJson(FileSnailRepository.FILE, { snails });
  }
}

function mapInstance(row: SnailInstanceRow): SnailInstance {
  return {
    id: row.id,
    snail_key: row.snail_key,
    session_ids: JSON.parse(row.session_ids),
    created_at: row.created_at,
  };
}
