import type { Snail, SnailInstance } from "@domain/snail/model";
import type { FileDataStore } from "@infra/file-data-store";
import type { SQLiteDatabase } from "@infra/database";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "snail-repo" });

/** Snail 持久层接口 */
export interface SnailRepository {
  /** 列出所有 snail */
  list(): Snail[];

  /** 按 key 查找 */
  findByKey(key: string): Snail | undefined;

  /** 创建 snail 配置 */
  create(snail: Snail): Snail;

  /** 更新 snail 配置（部分更新） */
  update(key: string, patch: Partial<Omit<Snail, 'key'>>): Snail;

  /** 删除 snail 配置 */
  remove(key: string): void;

  /** 按 key 统计 snail 实例数量 */
  countInstancesByKey(key: string): number;

  /** 按 key 统计关联 in_progress stage 的 role_snail_assignment 数量 */
  countActiveStageReferencesByKey(key: string): number;

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

  create(snail: Snail): Snail {
    if (this.snails.has(snail.key)) {
      throw new Error(`Snail with key "${snail.key}" already exists`);
    }
    // write-through: 先写文件，成功后再更新内存 Map
    this.saveSnailsWith([...this.snails.values(), snail]);
    this.snails.set(snail.key, snail);
    return snail;
  }

  update(key: string, patch: Partial<Omit<Snail, 'key'>>): Snail {
    const existing = this.snails.get(key);
    if (!existing) {
      throw new Error(`Snail with key "${key}" not found`);
    }
    const updated: Snail = { ...existing, ...patch, key };
    // write-through: 先写文件，成功后再更新内存 Map
    const list = [...this.snails.values()].map(s => s.key === key ? updated : s);
    this.saveSnailsWith(list);
    this.snails.set(key, updated);
    return updated;
  }

  remove(key: string): void {
    if (!this.snails.has(key)) {
      throw new Error(`Snail with key "${key}" not found`);
    }
    // write-through: 先写文件，成功后再更新内存 Map
    const list = [...this.snails.values()].filter(s => s.key !== key);
    this.saveSnailsWith(list);
    this.snails.delete(key);
  }

  countInstancesByKey(key: string): number {
    const row = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM snail_instance WHERE snail_key = ?`,
      [key],
    );
    return row?.count ?? 0;
  }

  countActiveStageReferencesByKey(key: string): number {
    const row = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM role_snail_assignment rsa
       JOIN stage s ON rsa.stage_id = s.id
       WHERE rsa.snail_key = ?
         AND s.entered_at IS NOT NULL
         AND s.left_at IS NULL`,
      [key],
    );
    return row?.count ?? 0;
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
    const content = this.dataStore.readFile(FileSnailRepository.FILE);
    if (content === null) return;

    let raw: { snails: Snail[] } | null;
    try {
      raw = JSON.parse(content) as { snails: Snail[] };
    } catch {
      // JSON 解析失败：备份损坏文件，视为空列表
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const corruptName = `${FileSnailRepository.FILE}.corrupt.${timestamp}`;
      try {
        this.dataStore.writeFile(corruptName, content);
        log.error(`snails.json corrupted, backed up as ${corruptName}`);
      } catch (backupErr) {
        log.error({ err: backupErr }, "failed to backup corrupted snails.json");
      }
      return;
    }
    if (!raw?.snails) return;

    for (const snail of raw.snails) {
      if (!snail.key) throw new Error("Invalid snails.json: snail.key is required");
      if (this.snails.has(snail.key)) throw new Error(`Invalid snails.json: duplicate snail key ${snail.key}`);
      this.snails.set(snail.key, snail);
    }
  }

  /** 将 snail 列表持久化到 snails.json */
  private saveSnailsWith(snails: Snail[]): void {
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
