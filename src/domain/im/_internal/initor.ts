import type { SQLiteDatabase } from "@infra/database";
import { SQLiteIMRepository } from "@domain/im/_internal/repository";
import { IMAdapter } from "@domain/im/_internal/adapter";

/** 初始化 IM 模块 */
export function init(db: SQLiteDatabase) {
  const repo = new SQLiteIMRepository(db);
  const adapter = new IMAdapter(repo);
  return { repo, adapter };
}
