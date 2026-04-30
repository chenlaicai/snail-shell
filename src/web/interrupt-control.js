export function bindInterruptControl(button, deps) {
  let target = null;
  let pendingTargetKey = null;

  function targetKeyOf(value) {
    return value ? `${value.conversationId}:${value.messageId}` : null;
  }

  function sync(conversationId = deps.getConversationId(), runningMessage = null) {
    const { getConversationId, isArchived } = deps;
    target = runningMessage && Number.isInteger(runningMessage.id) ? { conversationId, messageId: runningMessage.id } : null;
    const showInterrupt = Boolean(target) && conversationId === getConversationId() && !isArchived();
    button.hidden = !showInterrupt;
    const targetKey = targetKeyOf(target);
    if (!showInterrupt || pendingTargetKey !== targetKey) {
      pendingTargetKey = null;
      button.disabled = false;
    }
  }

  async function interrupt() {
    const { api, isArchived, syncAvailability, showNotice } = deps;
    if (!target || isArchived()) return;
    const interruptedTarget = target;
    pendingTargetKey = targetKeyOf(interruptedTarget);
    button.disabled = true;
    try {
      const result = await api("POST", `/conversations/${interruptedTarget.conversationId}/messages/${interruptedTarget.messageId}/interrupt`);
      if (!result?.interrupted) {
        showNotice("当前消息没有正在运行的 Snail。", false);
        pendingTargetKey = null;
        syncAvailability(interruptedTarget.conversationId);
      }
    } catch (err) {
      showNotice(`中断失败：${err.message}`, true);
      pendingTargetKey = null;
      syncAvailability(interruptedTarget.conversationId);
    }
  }

  button.addEventListener("click", interrupt);
  return { sync };
}
