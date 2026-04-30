export function bindInterruptControl(button, deps) {
  let target = null;

  function sync(conversationId = deps.getConversationId(), runningMessage = null) {
    const { getConversationId, isArchived } = deps;
    target = runningMessage && Number.isInteger(runningMessage.id) ? { conversationId, messageId: runningMessage.id } : null;
    const showInterrupt = Boolean(target) && conversationId === getConversationId() && !isArchived();
    button.hidden = !showInterrupt;
    if (!showInterrupt) button.disabled = false;
  }

  async function interrupt() {
    const { api, isArchived, syncAvailability, showNotice } = deps;
    if (!target || isArchived()) return;
    button.disabled = true;
    try {
      const result = await api("POST", `/conversations/${target.conversationId}/messages/${target.messageId}/interrupt`);
      if (!result?.interrupted) {
        showNotice("当前消息没有正在运行的 Snail。", false);
        syncAvailability(target.conversationId);
      }
    } catch (err) {
      showNotice(`中断失败：${err.message}`, true);
      syncAvailability(target.conversationId);
    }
  }

  button.addEventListener("click", interrupt);
  return { sync };
}
