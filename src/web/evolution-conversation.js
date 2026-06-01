import { renderMessages } from "./message-renderer.js";
import { escapeHtml } from "./message-view.js";

/**
 * Lightweight conversation panel embedded in the Evolution view.
 *
 * Unlike the full workspace MessageList + Composer, this component
 * renders messages and a simple text input without mention/reply features.
 * It is designed to be driven by an external message store (realtime manager)
 * or by direct API calls.
 */
export function createEvolutionConversation(input) {
  const { container, api, showNotice } = input;
  let currentConversationId = null;
  let onClose = null;

  function open(conversationId, options = {}) {
    currentConversationId = conversationId;
    onClose = options.onClose || null;
    renderShell();
    loadMessages();
  }

  function close() {
    currentConversationId = null;
    container.innerHTML = "";
  }

  function renderShell() {
    container.innerHTML = `
      <div class="evolution-conversation">
        <div class="evolution-conversation-header">
          <button class="ghost-button evolution-conv-back" type="button">← 返回详情</button>
          <span class="evolution-conv-title">治理对话</span>
        </div>
        <div class="evolution-conversation-messages" id="evolution-messages"></div>
        <div class="evolution-conversation-composer">
          <textarea class="evolution-conv-input" rows="3" placeholder="输入消息..."></textarea>
          <button class="primary-button evolution-conv-send" type="button">发送</button>
        </div>
      </div>
    `;
    bindEvents();
  }

  function bindEvents() {
    const backBtn = container.querySelector(".evolution-conv-back");
    const sendBtn = container.querySelector(".evolution-conv-send");
    const input = container.querySelector(".evolution-conv-input");

    backBtn?.addEventListener("click", () => {
      close();
      onClose?.();
    });

    sendBtn?.addEventListener("click", () => send());

    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  }

  async function loadMessages() {
    if (!currentConversationId) return;
    try {
      const snapshot = await api("GET", `/conversations/${currentConversationId}/messages/recent?limit=50`);
      const messages = Array.isArray(snapshot) ? snapshot : snapshot.items;
      if (!currentConversationId) return;
      renderMessageList(messages);
    } catch (err) {
      showNotice(`加载消息失败: ${err.message}`, true);
    }
  }

  function renderMessageList(messages) {
    const messagesEl = container.querySelector("#evolution-messages");
    if (!messagesEl) return;
    const state = { records: messages || [], byPersistedId: new Map() };
    for (const msg of state.records) {
      if (Number.isInteger(msg.id)) state.byPersistedId.set(msg.id, msg);
    }
    renderMessages(messagesEl, state, {});
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /**
   * Render from an external message store (used by realtime manager).
   * @param {object} store - message store with getState()
   * @param {string} conversationId
   */
  function renderFromStore(store, conversationId) {
    if (currentConversationId !== conversationId) return;
    const messagesEl = container.querySelector("#evolution-messages");
    if (!messagesEl) return;
    const state = store.getState();
    const wasAtBottom = messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 50;
    renderMessages(messagesEl, state, {});
    if (wasAtBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function send() {
    const input = container.querySelector(".evolution-conv-input");
    if (!input) return;
    const text = input.value.trim();
    if (!text || !currentConversationId) return;
    input.value = "";
    try {
      await api("POST", `/conversations/${currentConversationId}/messages`, {
        content: text,
        /** Evolution Center 是用户侧治理界面，发送者固定为 Boss Role（工作区所有者） */
        from_role: "Boss Role",
      });
    } catch (err) {
      showNotice(`发送失败: ${err.message}`, true);
      input.value = text;
    }
  }

  return { open, close, renderFromStore, getConversationId: () => currentConversationId };
}
