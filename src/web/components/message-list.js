import { renderMessages } from "../message-renderer.js";

/**
 * MessageList manages the message display area (#messages).
 *
 * It delegates actual message DOM rendering to message-renderer.js
 * and provides scroll control, message jumping, and scroll-up-to-load-more.
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
   * @param {function} [handlers.onLoadMore] - called when user scrolls to top to load older messages
   */
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this._isLoadingMore = false;
    this._bindScroll();
  }

  /**
   * Listen for scroll-to-top to trigger loading older messages.
   * 50px threshold gives a responsive feel before the user reaches absolute 0.
   */
  _bindScroll() {
    this.container.addEventListener("scroll", () => {
      if (this.container.scrollTop <= 50 && this.handlers.onLoadMore && !this._isLoadingMore) {
        this._loadMore();
      }
    });
  }

  /**
   * Load older messages while preserving the user's current viewport.
   *
   * Before loading: record scrollHeight and scrollTop.
   * After prepending: new content is above → scrollHeight grows.
   * Adjust scrollTop by the height delta so the same content stays visible.
   */
  async _loadMore() {
    this._isLoadingMore = true;
    const oldScrollHeight = this.container.scrollHeight;
    const oldScrollTop = this.container.scrollTop;
    try {
      const added = await this.handlers.onLoadMore();
      if (added > 0) {
        this.container.scrollTop = oldScrollTop + (this.container.scrollHeight - oldScrollHeight);
      }
    } finally {
      this._isLoadingMore = false;
    }
  }

  /**
   * Render a message store into the container.
   * @param {object} store - message store with getState() and getMessageById()
   * @param {string|null} conversationId
   */
  /**
   * Render messages into the container.
   *
   * Auto-scroll to bottom only if the user was already near the bottom before
   * this render — otherwise they may be reading history and shouldn't be yanked.
   * While loading older messages (_isLoadingMore), never auto-scroll.
   */
  render(store, conversationId) {
    const state = store.getState();
    /** 50px tolerance: tiny rounding / subpixel differences shouldn't block auto-scroll. */
    const wasAtBottom = this.container.scrollTop + this.container.clientHeight >= this.container.scrollHeight - 50;
    renderMessages(this.container, state, {
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
    if (wasAtBottom && !this._isLoadingMore) {
      this.container.scrollTop = this.container.scrollHeight;
    }
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
