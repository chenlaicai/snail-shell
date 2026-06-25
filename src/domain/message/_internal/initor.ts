import type { SQLiteDatabase } from "@infra/database";
import {
  SQLiteMessageRepository,
  SQLiteEventRepository,
  SQLiteContextRepository,
  SQLiteReadCursorRepository,
} from "@domain/message/_internal/repository";
import { MessageAdapter } from "@domain/message/_internal/adapter";

/** 初始化 Message 模块 */
export function init(db: SQLiteDatabase) {
  const messageRepo = new SQLiteMessageRepository(db);
  const eventRepo = new SQLiteEventRepository(db);
  const contextRepo = new SQLiteContextRepository(db);
  const cursorRepo = new SQLiteReadCursorRepository(db);

  const adapter = new MessageAdapter(
    messageRepo,
    eventRepo,
    contextRepo,
    cursorRepo,
  );

  return {
    messageRepo,
    eventRepo,
    contextRepo,
    cursorRepo,
    adapter,
  };
}
