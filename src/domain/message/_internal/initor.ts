import type { SQLiteDatabase } from "@infra/database";
import { getLogger } from "@infra/logger";
import {
  SQLiteMessageRepository,
  SQLiteEventRepository,
  SQLiteContextRepository,
  SQLiteReadCursorRepository,
} from "@domain/message/_internal/repository";
import { MessageAdapter } from "@domain/message/_internal/adapter";
import { MessageSearchIndex } from "@domain/message/_internal/search-index";

const log = getLogger({ module: "message" });

/** 初始化 Message 模块 */
export function init(db: SQLiteDatabase) {
  const messageRepo = new SQLiteMessageRepository(db);
  const eventRepo = new SQLiteEventRepository(db);
  const contextRepo = new SQLiteContextRepository(db);
  const cursorRepo = new SQLiteReadCursorRepository(db);

  const searchIndex = new MessageSearchIndex(db);

  // 启动时校验索引完整性
  if (!searchIndex.validate()) {
    log.info("Rebuilding message search index");
    searchIndex.rebuild();
  }

  const adapter = new MessageAdapter(
    messageRepo,
    eventRepo,
    contextRepo,
    cursorRepo,
    searchIndex,
  );

  return {
    messageRepo,
    eventRepo,
    contextRepo,
    cursorRepo,
    searchIndex,
    adapter,
  };
}
