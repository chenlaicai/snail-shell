export function renderBossMentionsBanner(target, mentions, onJump, escapeHtml) {
  if (!mentions.length) {
    target.className = "boss-mentions-banner";
    target.innerHTML = "";
    return;
  }

  target.className = "boss-mentions-banner visible";
  target.innerHTML = '<div class="name">Boss Mentions</div><div class="meta">以下 mention 已在本次进入会话时标记为已读，离开会话或刷新页面后列表会消失。</div>';
  mentions.forEach((mention) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "boss-mention-item";
    button.innerHTML = `<div class="meta">${escapeHtml(mention.from_snail || "unknown")} · ${escapeHtml(mention.created_at || "")}</div><div>${escapeHtml(mention.preview || "(空消息)")}</div>`;
    button.addEventListener("click", () => onJump(mention.message_id));
    target.appendChild(button);
  });
}
