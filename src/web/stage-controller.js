import { applyIssueReadonlyState, isIssueArchived } from "./issue-readonly-state.js";
import { dismissStageSelector, showStageSelector } from "./stage-selector.js";

/**
 * Stage 控制器：管理 SOP 转移、阶段渲染和阶段推进/回退操作。
 * 从 app.js 提取，保持 app.js 行数在限制内。
 */
export function createStageController({
  api,
  state,
  escapeHtml,
  showNotice,
  elements,
  canTransitionFrom,
}) {
  const { $input, $send } = elements;

  let refreshIssueAndRender = null;
  let getMessageStore = null;
  let loadMessages = null;
  let connectWS = null;

  /** 注入跨控制器依赖（app.js 创建所有控制器后调用）。 */
  function setup(deps) {
    refreshIssueAndRender = deps.refreshIssueAndRender;
    getMessageStore = deps.getMessageStore;
    loadMessages = deps.loadMessages;
    connectWS = deps.connectWS;
  }

  function isCurrentIssueArchived() { return isIssueArchived(state.currentIssue); }

  async function loadSopTransitions() {
    const sopId = state.currentIssue?.adopted_sop_id;
    if (!sopId) { state.currentSopTransitions = []; return; }
    try {
      const sop = await api("GET", `/sops/${sopId}`);
      state.currentSopTransitions = sop?.transitions ?? [];
    } catch {
      state.currentSopTransitions = [];
    }
  }

  function renderStages(workspaceContext) {
    if (state.stages.length === 0) {
      workspaceContext.renderContextRail();
      return;
    }
    workspaceContext.renderContextRail();
  }

  function renderStageActions() {
    applyIssueReadonlyState({
      elements: {
        input: $input,
        send: $send,
        newConversation: document.getElementById("new-conversation-btn"),
      },
      state,
      canTransitionFrom,
      transitions: state.currentSopTransitions,
    });
  }

  async function createNextStage() {
    if (isCurrentIssueArchived()) return;
    if (!state.currentIssue || !state.currentStage) return;
    dismissStageSelector();
    const transitions = state.currentSopTransitions ?? [];
    const currentSeq = state.currentStage.stage_definition?.sequence ?? 0;
    const sopData = await api("GET", `/sops/${state.currentIssue.adopted_sop_id}`).catch(() => null);
    const seqMap = Object.fromEntries((sopData?.stage_definitions ?? []).map((d) => [d.key, d.sequence ?? 0]));
    const forward = transitions.filter((t) =>
      t.from_stage_key === state.currentStage.type
      && t.to_stage_key !== state.currentStage.type
      && (seqMap[t.to_stage_key] ?? 0) > currentSeq
    );
    if (forward.length === 0) { showNotice("当前阶段无可用前进目标", true); return; }
    const targetStageKey = forward.length === 1
      ? forward[0].to_stage_key
      : await new Promise((resolve) => showStageSelector(forward, state.currentIssue.adopted_sop_id, api, escapeHtml, resolve));
    if (!targetStageKey) return;
    const selectionToken = state.conversationSelectionToken + 1;
    state.conversationSelectionToken = selectionToken;
    let result;
    try {
      result = await api("POST", `/issues/${state.currentIssue.id}/advance`, { target_stage_key: targetStageKey });
    } catch (err) {
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
    // 进入新阶段后自动触发 AI 工作，用户无需手动发消息
    api("POST", `/conversations/${result.conversation.id}/messages`, { content: "开始执行。" }).catch(() => {});
  }

  async function bounceStage() {
    if (isCurrentIssueArchived()) return;
    dismissStageSelector();
    const transitions = state.currentSopTransitions ?? [];
    const available = transitions.filter((t) => t.from_stage_key === state.currentStage?.type && t.to_stage_key !== state.currentStage?.type);
    if (available.length === 0) return;

    const targetStageKey = available.length === 1
      ? available[0].to_stage_key
      : await new Promise((resolve) => showStageSelector(available, state.currentIssue.adopted_sop_id, api, escapeHtml, resolve));

    if (!targetStageKey) return;
    const selectionToken = state.conversationSelectionToken + 1;
    state.conversationSelectionToken = selectionToken;
    let result;
    try {
      result = await api("POST", `/issues/${state.currentIssue.id}/bounce-stage`, { target_stage_key: targetStageKey });
    } catch (err) {
      showNotice(`阶段转移失败：${err.message}`, true);
      return;
    }
    state.stages = state.stages.map((stage) =>
      stage.id === result.completed_stage.id ? result.completed_stage : stage
    );
    state.stages.push(result.next_stage);
    state.currentStage = result.next_stage;
    state.conversations = [result.conversation];
    state.currentConversation = result.conversation;
    getMessageStore(result.conversation.id).reset(result.conversation.id);
    await refreshIssueAndRender();
    showNotice("已转移到目标阶段");
    await loadMessages(result.conversation.id, selectionToken);
    if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== result.conversation.id) return;
    connectWS(result.conversation.id);
    // 进入新阶段后自动触发 AI 工作，用户无需手动发消息
    api("POST", `/conversations/${result.conversation.id}/messages`, { content: "开始执行。" }).catch(() => {});
  }

  return { setup, loadSopTransitions, renderStages, renderStageActions, createNextStage, bounceStage };
}
