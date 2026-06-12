import {
  InMemoryMessageRepository,
  InMemoryEventRepository,
  InMemoryContextRepository,
  InMemoryReadCursorRepository,
  InMemoryCallSignalRepository,
} from "./repository";
import { MessageAdapter } from "./adapter";

/** 初始化 Message 模块 */
export function init() {
  const messageRepo = new InMemoryMessageRepository();
  const eventRepo = new InMemoryEventRepository();
  const contextRepo = new InMemoryContextRepository();
  const cursorRepo = new InMemoryReadCursorRepository();
  const callSignalRepo = new InMemoryCallSignalRepository();

  const adapter = new MessageAdapter(
    messageRepo,
    eventRepo,
    contextRepo,
    cursorRepo,
    callSignalRepo,
  );

  return {
    messageRepo,
    eventRepo,
    contextRepo,
    cursorRepo,
    callSignalRepo,
    adapter,
  };
}
