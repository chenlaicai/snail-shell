/**
 * lobby-view.js — IM 大厅视图渲染。
 *
 * 展示所有 IM 会话的导航状态、位置信息和操作按钮。
 */

const NAV_LEVEL_LABELS = {
  lobby: "大厅",
  workspace_list: "工作区列表",
  feature_list: "Feature 列表",
  in_conversation: "房间中",
};

const NAV_LEVEL_COLORS = {
  lobby: "#6b7280",
  workspace_list: "#2563eb",
  feature_list: "#7c3aed",
  in_conversation: "#059669",
};

const CHANNEL_LABELS = {
  feishu: "飞书",
  wechat: "微信",
};

/**
 * @param {HTMLElement} container
 * @param {{ sessions: Array, messages: Array|null, activeSessionId: string|null }} state
 * @param {{ onReset: (id: string) => void, onDelete: (id: string) => void, onViewMessages: (id: string) => void, onBack: () => void }} handlers
 */
export function renderLobby(container, state, handlers) {
  if (!container) return;

  if (state.messages && state.activeSessionId) {
    renderSessionDetail(container, state, handlers);
    return;
  }

  renderSessionList(container, state, handlers);
}

function renderSessionList(container, state, handlers) {
  const { sessions } = state;
  if (!sessions || sessions.length === 0) {
    container.innerHTML = `
      <div class="lobby-empty">
        <div class="lobby-empty-icon">📡</div>
        <div class="lobby-empty-title">暂无 IM 会话</div>
        <div class="lobby-empty-hint">在 <code>config/feishu.json</code> 的 <code>allowed_chats</code> 中添加飞书群后，IM 消息将出现在此处。</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="lobby-header">
      <div class="lobby-title">IM 大厅</div>
      <div class="lobby-subtitle">所有 IM 群聊的实时导航状态</div>
    </div>
    <div class="lobby-session-list">
      ${sessions.map((s) => renderSessionCard(s)).join("")}
    </div>
  `;

  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      const sessionId = btn.dataset.sessionId;
      if (action === "messages") handlers.onViewMessages(sessionId);
      else if (action === "reset") handlers.onReset(sessionId);
      else if (action === "delete") handlers.onDelete(sessionId);
    });
  });
}

function renderSessionCard(session) {
  const level = session.navigation_level || "lobby";
  const levelLabel = NAV_LEVEL_LABELS[level] || level;
  const levelColor = NAV_LEVEL_COLORS[level] || "#6b7280";
  const channelLabel = CHANNEL_LABELS[session.channel_type] || session.channel_type;
  const positionParts = [];
  if (session.current_workspace_id) positionParts.push(`工作区: ${session.current_workspace_id.slice(0, 8)}`);
  if (session.current_feature_id) positionParts.push(`Feature: ${session.current_feature_id.slice(0, 8)}`);
  if (session.current_conversation_id) positionParts.push(`会话: ${session.current_conversation_id.slice(0, 8)}`);
  const positionText = positionParts.length > 0 ? positionParts.join(" → ") : "—";

  return `
    <div class="lobby-session-card" data-session-id="${escapeAttr(session.id)}">
      <div class="lobby-session-header">
        <div class="lobby-session-channel">${escapeHtml(channelLabel)}</div>
        <span class="lobby-nav-badge" style="background:${levelColor}">${escapeHtml(levelLabel)}</span>
      </div>
      <div class="lobby-session-meta">
        <div class="lobby-session-field">
          <span class="lobby-session-label">Chat ID</span>
          <span class="lobby-session-value">${escapeHtml(session.channel_chat_id)}</span>
        </div>
        <div class="lobby-session-field">
          <span class="lobby-session-label">位置</span>
          <span class="lobby-session-value">${escapeHtml(positionText)}</span>
        </div>
        <div class="lobby-session-field">
          <span class="lobby-session-label">最后活跃</span>
          <span class="lobby-session-value">${escapeHtml(formatTime(session.last_command_at))}</span>
        </div>
      </div>
      <div class="lobby-session-actions">
        <button class="ghost-button" data-action="messages" data-session-id="${escapeAttr(session.id)}">消息记录</button>
        <button class="ghost-button" data-action="reset" data-session-id="${escapeAttr(session.id)}">重置到大厅</button>
        <button class="danger-button" data-action="delete" data-session-id="${escapeAttr(session.id)}">删除</button>
      </div>
    </div>
  `;
}

function renderSessionDetail(container, state, handlers) {
  const session = state.sessions.find((s) => s.id === state.activeSessionId);
  const messages = state.messages || [];

  container.innerHTML = `
    <div class="lobby-header">
      <button class="ghost-button lobby-back-btn" id="lobby-back-btn">← 返回列表</button>
      <div class="lobby-title">会话消息</div>
      ${session ? `<div class="lobby-subtitle">${escapeHtml(CHANNEL_LABELS[session.channel_type] || session.channel_type)} — ${escapeHtml(session.channel_chat_id)}</div>` : ""}
    </div>
    <div class="lobby-message-list">
      ${messages.length === 0 ? '<div class="lobby-empty-hint">暂无消息记录</div>' : messages.map(renderMessage).join("")}
    </div>
  `;

  const backBtn = container.querySelector("#lobby-back-btn");
  if (backBtn) backBtn.addEventListener("click", () => handlers.onBack());
}

function renderMessage(msg) {
  const isInbound = msg.direction === "inbound";
  const dirLabel = isInbound ? "入站" : "出站";
  const dirClass = isInbound ? "inbound" : "outbound";
  const commandBadge = msg.command ? `<span class="lobby-msg-command">${escapeHtml(msg.command)}</span>` : "";
  const responseHtml = msg.response_content ? `<div class="lobby-msg-response">${escapeHtml(msg.response_content)}</div>` : "";

  return `
    <div class="lobby-message ${dirClass}">
      <div class="lobby-message-header">
        <span class="lobby-message-direction ${dirClass}">${dirLabel}</span>
        ${commandBadge}
        <span class="lobby-message-time">${escapeHtml(formatTime(msg.created_at))}</span>
      </div>
      <div class="lobby-message-content">${escapeHtml(msg.content)}</div>
      ${responseHtml}
    </div>
  `;
}

function formatTime(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoString;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function escapeAttr(text) {
  return (text ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
