export function bindComposerKeyboard(input, deps) {
  input.addEventListener("keydown", (event) => {
    if (deps.isMentionActive()) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        deps.moveMentionSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      /** Enter (无 Shift) 确认 mention 选择；Shift+Enter 直接发送 */
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        deps.applyMentionSelection();
        return;
      }
    }
    if (event.key === "Escape") {
      deps.hideMentionSuggestions();
      deps.setMentionStatus("");
      return;
    }
    /** Shift+Enter 发送；Enter 走浏览器默认换行 */
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      deps.send();
    }
  });
}
