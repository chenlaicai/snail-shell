import { renderMessages } from "../message-renderer.js";

/**
 * MessageList manages the message display area (#messages).
 *
 * It delegates actual message DOM rendering to message-renderer.js
 * and provides scroll control and message jumping.
 */
export class MessageList {
  /**
   * @param {HTMLElement} container - the #messages element
   * @param {object} handlers
   * @param {function} handlers.onReply - called when user clicks reply on a message
   * @param {function} handlers.onSubmitQuestion - called when user submits a question response
   * @param {function} handlers.canInterruptMessage - checks if a message can be interrupted
   * @param {function} handlers.isInterruptPending - checks if interrupt is pending for a message
   * @param {function} handlers.onInterrupt - called when user clicks interrupt
   */
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
  }

  /**
   * Render a message store into the container.
   * @param {object} store - message store with getState() and getMessageById()
   * @param {string|null} conversationId
   */
  render(store, conversationId) {
    renderMessages(this.container, store.getState(), {
      onReply: (messageId) => {
        if (this.handlers.onReply) {
          const record = store.getMessageById(messageId);
          if (record) this.handlers.onReply(record);
        }
      },
      onSubmitQuestion: this.handlers.onSubmitQuestion,
      onPermissionApprove: this.handlers.onPermissionApprove,
      onPermissionDeny: this.handlers.onPermissionDeny,
      canInterruptMessage: (record, context) => {
        return Boolean(conversationId) && context.isAssistantRunning && !this.handlers.isArchived?.() && Number.isInteger(record.id);
      },
      isInterruptPending: (messageId) => {
        return this.handlers.isInterruptPending?.({ conversationId, messageId }) ?? false;
      },
      onInterrupt: async (messageId) => {
        if (this.handlers.onInterrupt) await this.handlers.onInterrupt(messageId);
      },
    });
    this.container.scrollTop = this.container.scrollHeight;
  }

  /** Clear messages and show empty state. */
  clear() {
    renderMessages(this.container, { records: [], byPersistedId: new Map() }, {});
  }

  /** Scroll to the bottom of the message list. */
  scrollToBottom() {
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Jump to a specific message by id.
   * @param {number|string} messageId
   */
  jumpTo(messageId) {
    const node = this.container.querySelector(`[data-message-id="${messageId}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("jump-highlight");
    setTimeout(() => node.classList.remove("jump-highlight"), 2200);
  }
}
