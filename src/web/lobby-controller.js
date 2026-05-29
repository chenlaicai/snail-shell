import { renderLobby } from "./lobby-view.js";

/**
 * IM 大厅控制器：管理 lobby session 列表、消息详情和操作。
 * 从 app.js 中提取，保持 app.js 行数在限制内。
 */
export function createLobbyController({ api, showNotice }) {
  let sessions = [];
  let activeSessionId = null;
  let messages = null;
  let root = null;

  async function load() {
    try {
      sessions = await api("GET", "/lobby/sessions");
      activeSessionId = null;
      messages = null;
      return sessions;
    } catch (err) {
      showNotice(`加载 IM 大厅失败：${err.message}`, true);
      return [];
    }
  }

  function render(container) {
    if (!container) return;
    root = container;
    renderLobby(container, { sessions, messages, activeSessionId }, {
      onReset: handleReset,
      onDelete: handleDelete,
      onViewMessages: handleViewMessages,
      onBack: handleBack,
    });
  }

  async function handleViewMessages(sessionId) {
    try {
      const data = await api("GET", `/lobby/sessions/${sessionId}`);
      activeSessionId = sessionId;
      messages = data.messages || [];
      if (root) render(root);
    } catch (err) {
      showNotice(`加载消息失败：${err.message}`, true);
    }
  }

  async function handleReset(sessionId) {
    if (!globalThis.confirm("重置此会话到大厅根？")) return;
    try {
      await api("POST", `/lobby/sessions/${sessionId}/reset`);
      await load();
      if (root) render(root);
      showNotice("会话已重置到大厅");
    } catch (err) {
      showNotice(`重置失败：${err.message}`, true);
    }
  }

  async function handleDelete(sessionId) {
    if (!globalThis.confirm("删除此会话？")) return;
    try {
      await api("DELETE", `/lobby/sessions/${sessionId}`);
      await load();
      if (root) render(root);
      showNotice("会话已删除");
    } catch (err) {
      showNotice(`删除失败：${err.message}`, true);
    }
  }

  function handleBack() {
    activeSessionId = null;
    messages = null;
    if (root) render(root);
  }

  return { load, render };
}
