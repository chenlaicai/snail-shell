import type { SQLiteDatabase } from "@infra/database";
import { getLogger } from "@infra/logger";
import { SQLiteEvolutionRepository } from "@domain/evolution/_internal/repository";
import { EvolutionAdapter } from "@domain/evolution/_internal/adapter";
import { EvolutionSearchIndex } from "@domain/evolution/_internal/search-index";

const log = getLogger({ module: "evolution" });

/** 初始化 Evolution 模块（纯数据层） */
export function init(db: SQLiteDatabase) {
  const repo = new SQLiteEvolutionRepository(db);
  const searchIndex = new EvolutionSearchIndex(db);

  // 启动时校验索引完整性
  if (!searchIndex.validate()) {
    log.info("Rebuilding evolution search index");
    searchIndex.rebuild();
  }

  const adapter = new EvolutionAdapter(repo, searchIndex);
  return { repo, searchIndex, adapter };
}
