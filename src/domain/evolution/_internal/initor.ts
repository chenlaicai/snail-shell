import type { SQLiteDatabase } from "@infra/database";
import { SQLiteEvolutionRepository } from "@domain/evolution/_internal/repository";
import { EvolutionAdapter } from "@domain/evolution/_internal/adapter";

/** 初始化 Evolution 模块（纯数据层） */
export function init(db: SQLiteDatabase) {
  const repo = new SQLiteEvolutionRepository(db);
  const adapter = new EvolutionAdapter(repo);
  return { repo, adapter };
}
