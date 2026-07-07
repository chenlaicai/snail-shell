import { SearchCoordinator } from "@domain/memory-search/_internal/coordinator";
import type { SearchCoordinatorPort, SearchChannel } from "@domain/memory-search/port";

/** 初始化 memory-search 模块 */
export function init(channels: SearchChannel[]): { adapter: SearchCoordinatorPort } {
  const coordinator = new SearchCoordinator();
  for (const channel of channels) {
    coordinator.registerChannel(channel);
  }
  return { adapter: coordinator };
}
