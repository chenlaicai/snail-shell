import { buildComposerEvents, createClientId } from "./composer-events.js";
import { hasRunningAssistantMessage } from "./send-availability.js";
import { isIssueArchived } from "./issue-readonly-state.js";
import { escapeHtml } from "./message-view.js";
import { renderBossMentionsBanner as renderBossMentionsBannerView } from "./boss-mentions-view.js";

/**
 * Conversation 控制器：管理对话选择、消息加载/发送、badge 刷新和实时连接。
 * 从 app.js 提取，保持 app.js 行数在限制内。
 */
export function createConversationController({
  api,
  state,
  composer,
  messageList,
  realtime,
  messageSync,
  elements,
}) {
  const { $input, $send, $bossMentionsBanner } = elements;

  function jumpToMessage(messageId) { messageList.jumpTo(messageId); }
  function renderBossMentionsBanner() { renderBossMentionsBannerView($bossMentionsBanner, state.activeBossMentions || [], jumpToMessage, escapeHtml); }

  let renderConversations = null;
  let renderHeader = null;
  let renderActiveMessages = null;

  /** 注入跨控制器依赖（app.js 创建所有控制器后调用）。 */
  function setup(deps) {
    renderConversations = deps.renderConversations;
    renderHeader = deps.renderHeader;
    renderActiveMessages = deps.renderActiveMessages;
  }

  function isCurrentIssueArchived() { return isIssueArchived(state.currentIssue); }
  function getMessageStore(conversationId) { return realtime.getStore(conversationId); }
  function connectWS(conversationId) { return messageSync.connect(conversationId); }

  async function selectConversation(conversationId) {
    const selectionToken = state.conversationSelectionToken + 1;
    state.conversationSelectionToken = selectionToken;
    state.currentConversation = state.conversations.find((c) => c.id === conversationId) || null;
    state.currentConversationSources = [];
    composer.clearReplyTarget();
    state.activeBossMentions = [];
    getMessageStore(conversationId);
    renderBossMentionsBanner();
    renderConversations();
    renderHeader();
    renderActiveMessages();
    if (!state.currentConversation) return;
    if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return;
    const sources = await loadConversationSources(state.currentConversation);
    if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return;
    state.currentConversationSources = sources;
    const activeBossMentions = await api("POST", `/conversations/${conversationId}/boss-mentions/ack`, {});
    if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return;
    state.activeBossMentions = activeBossMentions;
    messageList.scrollToBottom();
    const loaded = await loadMessages(conversationId, selectionToken);
    if (!loaded || selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return;
    connectWS(conversationId);
    composer.hideMentionSuggestions();
    composer.updateMentionComposer();
    renderBossMentionsBanner();
    if (loaded) { await refreshConversationBadges(); renderHeader(); }
  }

  async function loadConversationSources(conversation) {
    if (!conversation?.from_conversation_ids?.length) return [];
    return (await Promise.all(conversation.from_conversation_ids.map(async (id) => {
      try { return await api("GET", `/conversations/${id}`); } catch { return null; }
    }))).filter(Boolean);
  }

  async function loadStageConversations(stageId, options = {}) {
    state.conversations = await api("GET", `/stages/${stageId}/conversations`);
    renderConversations();
    const current = state.currentConversation && state.conversations.find((c) => c.id === state.currentConversation.id);
    const preferred = options.preferredConversationId ? state.conversations.find((c) => c.id === options.preferredConversationId) : null;
    if (current) { await selectConversation(current.id); }
    else if (preferred) { await selectConversation(preferred.id); }
    else if (state.conversations[0]) { await selectConversation(state.conversations[0].id); }
    else { state.conversationSelectionToken += 1; state.currentConversation = null; renderActiveMessages(); renderHeader(); }
  }

  async function refreshConversationBadges() {
    if (!state.currentStage) return;
    const latest = await api("GET", `/stages/${state.currentStage.id}/conversations`);
    state.conversations = latest;
    if (state.currentConversation) state.currentConversation = latest.find((c) => c.id === state.currentConversation.id) || state.currentConversation;
    renderConversations();
    renderHeader();
  }

  async function loadMessages(conversationId, selectionToken = state.conversationSelectionToken) {
    return messageSync.loadMessages(conversationId, selectionToken);
  }

  async function reconcileMessagesAfterStreaming(conversationId) {
    if (!conversationId || state.currentConversation?.id !== conversationId) return;
    const store = getMessageStore(conversationId);
    if (store) store.setHasMore(store.getState().records.length >= 20);
  }

  async function loadMoreMessages() {
    const conversationId = state.currentConversation?.id;
    if (!conversationId) return 0;
    try { return await messageSync.loadOlderMessages(conversationId); } catch { return 0; }
  }

  function applyConversationBadgeUpdate(payload) {
    const index = state.conversations.findIndex((c) => c.id === payload.conversation_id);
    if (index === -1) return;
    state.conversations[index] = { ...state.conversations[index], boss_pending_count: payload.boss_pending_count };
    if (state.currentConversation?.id === payload.conversation_id) state.currentConversation = state.conversations[index];
    renderConversations();
    renderHeader();
  }

  async function createConversation() {
    if (isCurrentIssueArchived()) return;
    if (!state.currentWorkspace || !state.currentIssue || !state.currentStage) return;
    const title = prompt("对话标题")?.trim();
    if (!title) return;
    await api("POST", `/issues/${state.currentIssue.id}/stages/${state.currentStage.id}/conversations`, {
      workspace_id: state.currentWorkspace.id, title, kind: "discussion",
      from_conversation_ids: state.currentConversation ? [state.currentConversation.id] : [],
    });
    await loadStageConversations(state.currentStage.id);
  }

  /** 发送消息的通用流程：乐观更新 → 实时发送 → API 回退。 */
  async function sendMessageWithFallback(events) {
    if (isCurrentIssueArchived()) return;
    if (!state.currentConversation) return;
    const conversationId = state.currentConversation.id;
    const store = getMessageStore(conversationId);
    if (hasRunningAssistantMessage(store)) return;
    const replyToMessageId = composer.getReplyTarget()?.id ?? null;
    const clientId = createClientId();
    store.addOptimisticMessage({ clientId, role: "user", from_role: "Boss Role", quoted_message_id: replyToMessageId, conversation_id: conversationId, created_at: new Date().toISOString(), events });
    composer.clear();
    $send.disabled = true;
    if (!realtime.send(conversationId, { type: "send_message", client_id: clientId, events, from_role: "Boss Role", quoted_message_id: replyToMessageId })) {
      try {
        await api("POST", `/conversations/${conversationId}/messages`, { client_id: clientId, events, from_role: "Boss Role", quoted_message_id: replyToMessageId });
        await loadMessages(conversationId);
        await refreshConversationBadges();
      } catch (err) { store.markOptimisticError(clientId, err.message); }
    }
    $send.disabled = false;
  }

  async function send() {
    if (!$input.value.trim() || !state.currentConversation) return;
    composer.clearInvalidMentionRanges();
    await sendMessageWithFallback(buildComposerEvents($input.value, composer.mentionState.selectedMentions));
  }

  async function sendStructuredResponse(content, payload) {
    if (!state.currentConversation) return;
    await sendMessageWithFallback([{ kind: "content_block", payload: { blocks: payload.blocks || [], fallback_text: payload.fallback_text || null } }]);
  }

  return {
    setup, selectConversation, loadStageConversations, loadMessages,
    reconcileMessagesAfterStreaming, loadMoreMessages, applyConversationBadgeUpdate,
    createConversation, send, sendStructuredResponse, getMessageStore, connectWS,
    refreshConversationBadges,
  };
}
