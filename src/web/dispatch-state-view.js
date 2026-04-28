export function renderDispatchState(target, dispatchState, currentConversation, escapeHtml) {
  target.innerHTML = "";
  const groups = dispatchState?.inbox_groups || [];
  if (!currentConversation) {
    target.innerHTML = '<div class="empty-state">未选择对话</div>';
    return;
  }
  if (!groups.length) {
    target.innerHTML = '<div class="empty-state">当前没有 dispatch</div>';
    return;
  }

  groups.forEach((group) => {
    const card = document.createElement("div");
    card.className = "dispatch-group";
    const previews = Array.isArray(group.messages)
      ? group.messages.map((message) => `#${message.message_id} ${message.from_snail || message.role}: ${message.preview || "(空消息)"}`).join("\n")
      : "";
    card.innerHTML = `
      <div class="name">${escapeHtml(group.target_snail)}</div>
      <div class="meta">status: ${escapeHtml(group.status)} · dispatches: ${group.dispatch_ids.length} · messages: ${group.message_ids.length}</div>
      <div class="meta" style="margin-top: 6px;">latest: ${escapeHtml(group.latest_dispatch_at || "")}</div>
      ${previews ? `<div class="dispatch-preview">${escapeHtml(previews)}</div>` : ""}
    `;
    target.appendChild(card);
  });
}
