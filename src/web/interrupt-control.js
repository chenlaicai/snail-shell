export function createInterruptController(deps) {
  let pendingTargetKey = null;

  return {
    isPending(target) {
      return pendingTargetKey === targetKeyOf(target);
    },
    async interrupt(target) {
      const { api, isArchived, syncAvailability, showNotice } = deps;
      if (!target || isArchived()) return;
      if (pendingTargetKey === targetKeyOf(target)) return;
      pendingTargetKey = targetKeyOf(target);
      try {
        const result = await api("POST", `/conversations/${target.conversationId}/messages/${target.messageId}/interrupt`);
        if (!result?.interrupted) {
          showNotice("当前消息没有正在运行的 Snail。", false);
          pendingTargetKey = null;
          syncAvailability(target.conversationId);
        }
      } catch (err) {
        showNotice(`中断失败：${err.message}`, true);
        pendingTargetKey = null;
        syncAvailability(target.conversationId);
      }
    },
    clearIfNot(target) {
      if (!target || pendingTargetKey !== targetKeyOf(target)) pendingTargetKey = null;
    },
  };
}

function targetKeyOf(value) {
  return value ? `${value.conversationId}:${value.messageId}` : null;
}
