export function bindInterruptControl(button, deps) {
  function sync(conversationId = deps.getConversationId(), running = false) {
    const { getConversationId, isArchived } = deps;
    const showInterrupt = Boolean(conversationId) && conversationId === getConversationId() && !isArchived() && running;
    button.hidden = !showInterrupt;
    if (!showInterrupt) button.disabled = false;
  }

  async function interrupt() {
    const { api, getConversationId, isArchived, hasRunningAssistant, syncAvailability, showNotice } = deps;
    const conversationId = getConversationId();
    if (!conversationId || isArchived() || !hasRunningAssistant(conversationId)) return;
    button.disabled = true;
    try {
      const result = await api("POST", `/conversations/${conversationId}/interrupt`);
      if (!result?.interrupted) {
        showNotice("当前没有正在运行的 Snail。", false);
        syncAvailability(conversationId);
      }
    } catch (err) {
      showNotice(`中断失败：${err.message}`, true);
      syncAvailability(conversationId);
    }
  }

  button.addEventListener("click", interrupt);
  return { sync };
}
