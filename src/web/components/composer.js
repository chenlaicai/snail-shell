/**
 * Composer manages the message input area: textarea, mention system,
 * reply banner, send button, and interrupt button.
 *
 * It owns the mention state machine and delegates structured-event
 * construction to composer-events.js.
 */
export class Composer {
  /**
   * @param {object} elements
   * @param {HTMLTextAreaElement} elements.input
   * @param {HTMLButtonElement} elements.send
   * @param {HTMLElement} elements.mentionStatus
   * @param {HTMLElement} elements.mentionSuggestions
   * @param {HTMLElement} elements.replyBanner
   * @param {HTMLElement} elements.replyBannerText
   * @param {HTMLButtonElement} elements.replyCancel
   * @param {HTMLButtonElement} elements.interruptBtn
   * @param {object} deps
   * @param {function} deps.getAvailableRoles - returns available role objects for current conversation
   * @param {function} deps.isArchived - returns true if current issue is archived
   * @param {function} deps.escapeHtml - HTML escape function
   * @param {function} deps.buildComposerEvents - from composer-events.js
   * @param {function} deps.getMessageStore - returns the message store for a conversation
   * @param {function} deps.hasRunningAssistant - checks if assistant is running
   */
  constructor(elements, deps = {}) {
    this.elements = elements;
    this.deps = deps;

    /** @type {{active:boolean, start:number, end:number, query:string, suggestions:Array, selectedIndex:number, selectedMentions:Array}} */
    this.mentionState = {
      active: false,
      start: -1,
      end: -1,
      query: "",
      suggestions: [],
      selectedIndex: 0,
      selectedMentions: [],
    };

    /** @type {{id:*, speaker:string, preview:string}|null} */
    this.replyTarget = null;
  }

  // ── Reply banner ──────────────────────────────────────────────

  setReplyTarget(record) {
    if (!record) {
      this.replyTarget = null;
      this._renderReplyBanner();
      return;
    }
    this.replyTarget = {
      id: record.id,
      speaker: this.deps.messageSpeaker?.(record) || "unknown",
      preview: (this.deps.summarizeRecord?.(record) || "").slice(0, 120),
    };
    this._renderReplyBanner();
  }

  getReplyTarget() {
    return this.replyTarget;
  }

  clearReplyTarget() {
    this.replyTarget = null;
    this._renderReplyBanner();
  }

  _renderReplyBanner() {
    const { replyBanner, replyBannerText } = this.elements;
    if (!this.replyTarget) {
      replyBanner.className = "reply-banner";
      replyBannerText.textContent = "";
      return;
    }
    replyBanner.className = "reply-banner visible";
    const escapeHtml = this.deps.escapeHtml || ((s) => s);
    replyBannerText.innerHTML = `<strong>回复 ${escapeHtml(this.replyTarget.speaker)}</strong> ${escapeHtml(this.replyTarget.preview || "(空消息)")}`;
  }

  // ── Mention system ────────────────────────────────────────────

  setMentionStatus(message = "", kind = "") {
    this.elements.mentionStatus.textContent = message;
    this.elements.mentionStatus.className = `mention-status${kind ? ` ${kind}` : ""}`;
  }

  hideMentionSuggestions() {
    this.mentionState.active = false;
    this.mentionState.start = -1;
    this.mentionState.end = -1;
    this.mentionState.query = "";
    this.mentionState.suggestions = [];
    this.mentionState.selectedIndex = 0;
    this.elements.mentionSuggestions.className = "mention-suggestions";
    this.elements.mentionSuggestions.innerHTML = "";
  }

  clearInvalidMentionRanges() {
    this.mentionState.selectedMentions = this.mentionState.selectedMentions.filter((mention) => {
      const current = this.elements.input.value.slice(mention.start, mention.end);
      return current === mention.raw;
    });
  }

  isMentionActive() {
    return this.mentionState.active && this.mentionState.suggestions.length > 0;
  }

  moveMentionSelection(delta) {
    this.mentionState.selectedIndex = (this.mentionState.selectedIndex + delta + this.mentionState.suggestions.length) % this.mentionState.suggestions.length;
    this._renderMentionSuggestions();
  }

  applyMentionSelection() {
    this.applyMentionSuggestion(this.mentionState.selectedIndex);
  }

  applyMentionSuggestion(index) {
    const role = this.mentionState.suggestions[index];
    if (!role) return;
    const input = this.elements.input;
    const before = input.value.slice(0, this.mentionState.start);
    const after = input.value.slice(this.mentionState.end).replace(/^\s*/, "");
    const nextValue = `${before}@${role.name}${after ? ` ${after}` : " "}`;
    input.value = nextValue;
    this.mentionState.selectedMentions = this.mentionState.selectedMentions.filter(
      (m) => m.end <= this.mentionState.start || m.start >= this.mentionState.end
    );
    this.mentionState.selectedMentions.push({
      start: before.length,
      end: before.length + `@${role.name}`.length,
      raw: `@${role.name}`,
      role,
    });
    const nextCaret = `${before}@${role.name} `.length;
    input.focus();
    input.setSelectionRange(nextCaret, nextCaret);
    this.hideMentionSuggestions();
    this.setMentionStatus(`当前将发给 ${role.name}`, "info");
  }

  updateMentionComposer() {
    const availableRoles = this.deps.getAvailableRoles?.() || [];
    const input = this.elements.input;
    const value = input.value;
    const caret = input.selectionStart ?? value.length;
    const mentionStart = value.lastIndexOf("@", caret - 1);

    if (mentionStart === -1) {
      this.hideMentionSuggestions();
      this.setMentionStatus(availableRoles.length ? `可 @ ${availableRoles.map((item) => item.name).join(" / ")}` : "");
      return;
    }

    const prefix = value.slice(0, mentionStart);
    if (prefix && !/[\s\n]$/.test(prefix)) {
      this.hideMentionSuggestions();
      this.setMentionStatus(availableRoles.length ? `可 @ ${availableRoles.map((item) => item.name).join(" / ")}` : "");
      return;
    }

    const tail = value.slice(mentionStart + 1);
    const segment = tail.split("\n")[0];
    const typedUntilCaret = value.slice(mentionStart + 1, caret);
    const query = typedUntilCaret.trim();
    const matches = availableRoles.filter((role) => role.name.toLowerCase().includes(query.toLowerCase()));

    this.mentionState.active = true;
    this.mentionState.start = mentionStart;
    this.mentionState.end = mentionStart + 1 + segment.length;
    this.mentionState.query = query;
    this.mentionState.suggestions = matches;
    this.mentionState.selectedIndex = Math.min(this.mentionState.selectedIndex, Math.max(matches.length - 1, 0));

    if (matches.length) {
      this.setMentionStatus("选择一个 role 作为当前消息目标", "info");
      this._renderMentionSuggestions();
      return;
    }

    this._renderMentionSuggestions();
    this.setMentionStatus(query ? "继续输入或将其作为普通文本发送" : "继续输入以搜索当前 conversation 中可用的 role", "info");
  }

  _renderMentionSuggestions() {
    const container = this.elements.mentionSuggestions;
    const escapeHtml = this.deps.escapeHtml || ((s) => s);

    if (!this.mentionState.active || !this.mentionState.suggestions.length) {
      container.className = "mention-suggestions";
      container.innerHTML = "";
      return;
    }

    container.className = "mention-suggestions visible";
    container.innerHTML = this.mentionState.suggestions.map((role, index) => `
      <button type="button" class="mention-suggestion${index === this.mentionState.selectedIndex ? " active" : ""}" data-mention-index="${index}">
        <div class="mention-suggestion-title">@${escapeHtml(role.name)}</div>
        <div class="mention-suggestion-meta">${escapeHtml(role.description || "")}</div>
      </button>
    `).join("");

    Array.from(container.querySelectorAll("[data-mention-index]")).forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyMentionSuggestion(Number(button.getAttribute("data-mention-index")));
      });
    });
  }

  // ── Send state ────────────────────────────────────────────────

  /** Clear the input area after sending. */
  clear() {
    this.elements.input.value = "";
    this.elements.input.dispatchEvent(new Event("input"));
    this.mentionState.selectedMentions = [];
    this.hideMentionSuggestions();
    this.setMentionStatus("");
    this.replyTarget = null;
    this._renderReplyBanner();
  }

  setSendEnabled(enabled) {
    this.elements.send.disabled = !enabled;
  }
}
