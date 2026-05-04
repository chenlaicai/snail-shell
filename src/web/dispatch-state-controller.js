import { renderDispatchState as renderDispatchStateView } from "./dispatch-state-view.js";

export function createDispatchStateController(input) {
  let currentState = null;

  function render() {
    renderDispatchStateView(input.diagnosticTarget, currentState, input.getCurrentConversation(), input.escapeHtml, { mode: "diagnostic" });
    renderDispatchStateView(input.boardTarget, currentState, input.getCurrentConversation(), input.escapeHtml, { mode: "board" });
  }

  async function load(conversationId, selectionToken) {
    currentState = await input.api("GET", `/conversations/${conversationId}/dispatch-state`);
    if (!input.isCurrentSelection(conversationId, selectionToken)) return false;
    render();
    return true;
  }

  function refresh(conversationId, selectionToken, delayMs = 0) {
    if (!conversationId) return;
    const run = () => load(conversationId, selectionToken).catch(() => {});
    if (delayMs > 0) setTimeout(run, delayMs);
    else run();
  }

  return { load, refresh, render };
}
