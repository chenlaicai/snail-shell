/**
 * Stage 转移建议横幅：AI 提议阶段转移时显示确认/拒绝 UI。
 */

export function createStageSuggestionBanner({ api, state, escapeHtml, showNotice, getStageTitle, refreshIssueAndRender, getMessageStore, loadMessages, connectWS }) {
  let currentSuggestion = null;

  function show(suggestion) {
    if (!state.currentIssue || suggestion.issueId !== state.currentIssue.id) return;
    currentSuggestion = suggestion;
    dismiss();
    const banner = document.createElement("div");
    banner.id = "stage-suggestion-banner";
    banner.className = "stage-suggestion-banner";
    const fromTitle = getStageTitle?.(suggestion.fromStageKey) || suggestion.fromStageKey;
    const toTitle = getStageTitle?.(suggestion.toStageKey) || suggestion.toStageKey;
    const reasonHtml = suggestion.reason ? `<span class="suggestion-reason">${escapeHtml(suggestion.reason)}</span>` : "";
    banner.innerHTML = `<div class="suggestion-content"><span class="suggestion-text">AI 建议从 <strong>${escapeHtml(fromTitle)}</strong> 推进到 <strong>${escapeHtml(toTitle)}</strong>${reasonHtml ? "：" : ""}</span>${reasonHtml}</div><div class="suggestion-actions"><button class="suggestion-confirm-btn" title="确认推进">确认推进</button><button class="suggestion-reject-btn" title="忽略">忽略</button></div>`;
    banner.querySelector(".suggestion-confirm-btn").addEventListener("click", () => confirm());
    banner.querySelector(".suggestion-reject-btn").addEventListener("click", () => reject());
    const stageArea = document.querySelector(".stage-actions") || document.getElementById("composer-area");
    if (stageArea) stageArea.prepend(banner);
  }

  function dismiss() {
    document.getElementById("stage-suggestion-banner")?.remove();
  }

  async function confirm() {
    if (!state.currentIssue || !currentSuggestion) return;
    const savedSuggestion = currentSuggestion;
    currentSuggestion = null;
    dismiss();
    const selectionToken = state.conversationSelectionToken + 1;
    state.conversationSelectionToken = selectionToken;
    let result;
    try {
      result = await api("POST", `/issues/${state.currentIssue.id}/confirm-stage-suggestion`);
    } catch (err) {
      // 失败时恢复建议和横幅，允许用户重试
      currentSuggestion = savedSuggestion;
      show(savedSuggestion);
      showNotice(`推进失败：${err.message}`, true);
      return;
    }
    state.stages = state.stages.map((stage) =>
      stage.id === result.completed_stage.id ? result.completed_stage : stage
    );
    if (!result.next_stage) {
      showNotice(`Issue "${state.currentIssue.title}" 流程已完成`);
      state.currentStage = result.completed_stage;
      state.conversations = [];
      state.currentConversation = null;
      await refreshIssueAndRender();
      return;
    }
    state.stages.push(result.next_stage);
    state.currentStage = result.next_stage;
    state.conversations = result.conversation ? [result.conversation] : [];
    state.currentConversation = result.conversation;
    if (result.conversation) getMessageStore(result.conversation.id).reset(result.conversation.id);
    await refreshIssueAndRender();
    if (!result.conversation) return;
    await loadMessages(result.conversation.id, selectionToken);
    if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== result.conversation.id) return;
    connectWS(result.conversation.id);
  }

  async function reject() {
    if (!state.currentIssue) return;
    currentSuggestion = null;
    dismiss();
    try {
      await api("POST", `/issues/${state.currentIssue.id}/reject-stage-suggestion`);
    } catch { /* ignore */ }
  }

  function clearState() {
    currentSuggestion = null;
    dismiss();
  }

  return { show, clearState };
}
