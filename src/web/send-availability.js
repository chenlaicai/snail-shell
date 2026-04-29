export function hasRunningAssistantMessage(store) {
  return store.getState().records.some((record) => record.role === "assistant" && ["pending", "thinking", "streaming", "idle"].includes(record.statusView));
}
