/**
 * MCP 层与 collaboration 层共享的路由目标 store。
 *
 * MCP set_final_body 写入 to_speakers，collaboration resolveReplies 读取并消费。
 * 进程内存存储，重启丢失——routing targets 是瞬态数据，无需持久化。
 */
export interface McpMessageStore {
  getMcpRoutingTargets(messageId: number): string[] | undefined;
  setMcpRoutingTargets(messageId: number, targets: string[]): void;
  deleteMcpRoutingTargets(messageId: number): void;
}

export function createMcpMessageStore(): McpMessageStore {
  const store = new Map<number, string[]>();
  return {
    getMcpRoutingTargets(messageId: number) {
      return store.get(messageId);
    },
    setMcpRoutingTargets(messageId: number, targets: string[]) {
      store.set(messageId, targets);
    },
    deleteMcpRoutingTargets(messageId: number) {
      store.delete(messageId);
    },
  };
}
