export function hasRunningAssistantMessage(store) {
  return Boolean(getRunningAssistantMessage(store));
}

export function getRunningAssistantMessage(store) {
  return store.getState().records.find((record) => record.role === "assistant" && Number.isInteger(record.id) && ["pending", "thinking", "streaming", "idle"].includes(record.statusView)) || null;
}
