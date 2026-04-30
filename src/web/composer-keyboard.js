export function bindComposerKeyboard(input, deps) {
  input.addEventListener("keydown", (event) => {
    if (deps.isMentionActive()) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        deps.moveMentionSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        if (event.key === "Enter" && event.shiftKey) return;
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      deps.send();
    }
  });
}
