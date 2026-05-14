import { renderMessages } from "./message-renderer.js";
import { escapeHtml, summarizeRecord, messageSpeaker } from "./message-view.js";
import { renderBossMentionsBanner as renderBossMentionsBannerView } from "./boss-mentions-view.js";
import { renderArtifactsView, renderArtifactTypeOptions as renderArtifactTypeOptionsView } from "./artifact-view.js";
import { createPromptCenter } from "./prompt-library.js";
import { createSkillCenter } from "./skill-center-view.js";
import { createMessageSyncController } from "./message-sync-controller.js";
import { createRealtimeManager } from "./realtime-manager.js";
import { renderDispatchState as renderDispatchStateView } from "./dispatch-state-view.js";
import { renderFeatureList } from "./feature-list-view.js";
import { renderProjectTree } from "./project-tree-view.js";
import { canRestartFeatureDevelopment } from "./feature-workflow-state.js";
import { createWorkspaceContext } from "./workspace-context.js";
import { getRunningAssistantMessage, hasRunningAssistantMessage } from "./send-availability.js";
import { renderStageContractView } from "./stage-contract-view.js";
import { applyFeatureReadonlyState, isFeatureArchived } from "./feature-readonly-state.js";
import { buildComposerEvents as buildComposerEventsFromState, createClientId } from "./composer-events.js";
import { createInterruptController } from "./interrupt-control.js";
import { bindComposerKeyboard } from "./composer-keyboard.js";
import { createKnowledgeCenter } from "./knowledge-center.js";
import { applyPrimaryView } from "./primary-view.js";
import { mountUiShell } from "./ui-shell.js";
import { editRepoContext as editFeatureRepoContext, renderRepoContextCard as renderRepoContextCardView } from "./repo-context-view.js";
import { renderConversationSourceEmptyState as renderConversationSourceEmptyStateView } from "./conversation-source-empty-state.js";
import { createSnailDenController } from "./snail-den-controller.js";
import { buildArchiveCleanupNotice } from "./archive-cleanup-notice.js";

const API = "/api";
let STAGE_DEFINITIONS = {};

const $appRoot = document.getElementById("app-root");
mountUiShell($appRoot);

const state = {
  projects: [], currentProject: null,
  features: [], currentFeature: null,
  stages: [], currentStage: null,
  conversations: [], currentConversation: null,
  currentConversationSources: [],
  artifacts: [], artifactDefinitions: {}, snails: [],
  conversationSelectionToken: 0,
  dispatchState: null,
  activeBossMentions: [], selectedFormalArtifactIds: new Set(),
  replyToMessage: null,
  activePrimaryView: "projects",
};

const $projectList = document.getElementById("project-list");
const $messages = document.getElementById("messages");
const $bossMentionsBanner = document.getElementById("boss-mentions-banner");
const $input = document.getElementById("input");
const $send = document.getElementById("send-btn");
const $topProjectState = document.getElementById("top-project-state");
const $projectSummaryCard = document.getElementById("project-summary-card");
const $appNotice = document.getElementById("app-notice");
const $stageList = document.getElementById("stage-list");
const $stageContract = document.getElementById("stage-contract");
const $stageSummaryCard = document.getElementById("stage-summary-card"), $participantsSummaryCard = document.getElementById("participants-summary-card"), $deliverablesSummaryCard = document.getElementById("deliverables-summary-card");
const $artifactList = document.getElementById("artifact-list"), $artifactType = document.getElementById("artifact-type"), $artifactContent = document.getElementById("artifact-content");
const $dispatchStateList = document.getElementById("dispatch-state-list");
const $mentionStatus = document.getElementById("mention-status"), $mentionSuggestions = document.getElementById("mention-suggestions");
const $replyBanner = document.getElementById("reply-banner"), $replyBannerText = document.getElementById("reply-banner-text"), $replyCancel = document.getElementById("reply-cancel");
const $restartDevelopment = document.getElementById("restart-development-btn");
const $navProjects = document.getElementById("nav-projects"), $navKnowledge = document.getElementById("nav-knowledge"), $navSnailDen = document.getElementById("nav-snail-den"), $navPrompts = document.getElementById("nav-prompts"), $navSkills = document.getElementById("nav-skills");
const $workspaceMain = document.getElementById("workspace-main"), $knowledgePanel = document.getElementById("knowledge-panel"), $snailDenPanel = document.getElementById("snail-den-panel"), $promptPanel = document.getElementById("prompt-panel"), $skillPanel = document.getElementById("skill-panel");
const $promptCenterPage = document.getElementById("prompt-center-page");
const $skillCenterPage = document.getElementById("skill-center-page");
const $appShell = document.querySelector(".app-shell");
const $viewRelated = document.querySelectorAll("[data-view-related]");
const $directorySwitcher = document.getElementById("directory-switcher"), $directoryToggle = document.getElementById("directory-toggle"), $directoryChevron = document.getElementById("directory-chevron");
const $knowledgeSummary = document.getElementById("knowledge-summary"), $knowledgeList = document.getElementById("knowledge-list"), $knowledgeDetail = document.getElementById("knowledge-detail");
const $knowledgePendingCount = document.getElementById("knowledge-pending-count");
const $knowledgeLibrary = document.getElementById("knowledge-library-btn"), $knowledgeCandidates = document.getElementById("knowledge-candidates-btn"), $knowledgeProject = document.getElementById("knowledge-project-btn");
const $createArtifact = document.getElementById("create-artifact-btn"), $setFormalArtifact = document.getElementById("set-formal-artifact-btn"), $nextStage = document.getElementById("next-stage-btn");
const $repoContextCard = document.getElementById("repo-context-card"), $repoContextSummaryCard = document.getElementById("repo-context-summary-card"), $repoContextEdit = document.getElementById("repo-context-edit-btn");
const $drawerBackdrop = document.getElementById("drawer-backdrop"), $inspectorDrawer = document.getElementById("inspector-drawer");
const $inspectorClose = document.getElementById("inspector-close");
const $inspectorTabs = document.getElementById("inspector-tabs");

const mentionState = {
  active: false,
  start: -1,
  end: -1,
  query: "",
  suggestions: [],
  selectedIndex: 0,
  selectedMentions: [],
};

const promptCenter = createPromptCenter({ root: $promptCenterPage });
const skillCenter = createSkillCenter({ root: $skillCenterPage });

const interruptControl = createInterruptController({
  api,
  isArchived: isCurrentFeatureArchived,
  syncAvailability: syncSendAvailability,
  showNotice,
});

const workspaceContext = createWorkspaceContext({
  elements: {
    projectSummaryCard: $projectSummaryCard,
    stageSummaryCard: $stageSummaryCard,
    participantsSummaryCard: $participantsSummaryCard,
    deliverablesSummaryCard: $deliverablesSummaryCard,
    drawerBackdrop: $drawerBackdrop,
    inspectorDrawer: $inspectorDrawer,
    inspectorClose: $inspectorClose,
    inspectorTabs: $inspectorTabs,
  },
  state,
  getStageDefinitions: () => STAGE_DEFINITIONS,
  stageTitle,
  artifactTitle,
  escapeHtml,
});

const knowledgeCenter = createKnowledgeCenter({
  api,
  elements: { summary: $knowledgeSummary, list: $knowledgeList, detail: $knowledgeDetail },
  getCurrentProject: () => state.currentProject,
  showNotice,
  onStateChange: renderKnowledgeContext,
});

const snailDenController = createSnailDenController({ api, showNotice });

function renderMessageStore(store) {
  const conversationId = state.currentConversation?.id || null;
  renderMessages($messages, store.getState(), {
    onReply(messageId) {
      const record = store.getMessageById(messageId);
      if (!record) return;
      setReplyTarget(record);
      $input.focus();
    },
    onSubmitQuestion: sendStructuredResponse,
    canInterruptMessage(record, context) {
      return Boolean(conversationId) && context.isAssistantRunning && !isCurrentFeatureArchived() && Number.isInteger(record.id);
    },
    isInterruptPending(messageId) {
      return interruptControl.isPending({ conversationId, messageId });
    },
    async onInterrupt(messageId) {
      const target = { conversationId, messageId };
      const interruptPromise = interruptControl.interrupt(target);
      renderMessageStore(store);
      await interruptPromise;
      renderMessageStore(store);
    },
  });
  $messages.scrollTop = $messages.scrollHeight;
}

function renderActiveMessageStore(store) {
  renderMessageStore(store);
  renderConversationSourceEmptyState(store.getState());
}

function syncSendAvailability(conversationId = state.currentConversation?.id || null) {
  if (!conversationId || state.currentConversation?.id !== conversationId) {
    $send.disabled = isCurrentFeatureArchived();
    return;
  }
  const store = getMessageStore(conversationId);
  const runningMessage = getRunningAssistantMessage(store);
  $send.disabled = isCurrentFeatureArchived() || Boolean(runningMessage);
  interruptControl.clearIfNot(runningMessage ? { conversationId, messageId: runningMessage.id } : null);
  if (state.currentConversation?.id === conversationId) renderActiveMessageStore(store);
}

const realtime = createRealtimeManager({
  websocketUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  },
  onStoreChange(conversationId, store) {
    if (state.currentConversation?.id !== conversationId) return;
    renderMessageStore(store);
    syncSendAvailability(conversationId);
  },
  onMessageStarted(conversationId) {
    if (state.currentConversation?.id === conversationId) $send.disabled = true;
    refreshConversationBadges().catch(() => {});
  },
  onMessageEventAppended(conversationId, eventId) {
    messageSync.updateCursor(conversationId, eventId);
  },
  onMessageStatusChanged(conversationId) {
    reconcileMessagesAfterStreaming(conversationId);
    refreshConversationBadges().catch(() => {});
    syncSendAvailability(conversationId);
  },
  onSocketError(conversationId, error, clientId) {
    if (state.currentConversation?.id !== conversationId) return;
    if (clientId) getMessageStore(conversationId).markOptimisticError(clientId, error);
    showNotice(`Error: ${error}`, true);
    $send.disabled = false;
  },
  onSocketOpen(conversationId) {
    if (state.currentConversation?.id !== conversationId) return;
    messageSync.clearReconnectTimer(conversationId);
    loadMessages(conversationId).catch(() => {});
  },
  onSocketClose(conversationId) {
    messageSync.scheduleReconnect(conversationId);
  },
  onConversationBadge: applyConversationBadgeUpdate,
});

function getMessageStore(conversationId) { return realtime.getStore(conversationId); }

const messageSync = createMessageSyncController({
  api,
  getMessageStore,
  isActiveConversation: (conversationId) => state.currentConversation?.id === conversationId,
  isCurrentSelection: (conversationId, selectionToken) => selectionToken === state.conversationSelectionToken && state.currentConversation?.id === conversationId,
  loadDispatchState: async (conversationId, selectionToken) => {
    state.dispatchState = await api("GET", `/conversations/${conversationId}/dispatch-state`);
    if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return false;
    renderDispatchState();
    return true;
  },
  realtime,
  syncSendAvailability,
});

function getActiveMessageStore() { return state.currentConversation ? getMessageStore(state.currentConversation.id) : null; }

function isCurrentFeatureArchived() { return isFeatureArchived(state.currentFeature); }

function renderActiveMessages() {
  const store = getActiveMessageStore();
  if (store) {
    renderActiveMessageStore(store);
    syncSendAvailability(state.currentConversation?.id || null);
  } else {
    renderMessages($messages, { records: [], byPersistedId: new Map() }, {});
    $send.disabled = isCurrentFeatureArchived();
    interruptControl.clearIfNot(null);
  }
}

function renderConversationSourceEmptyState(messageState) {
  renderConversationSourceEmptyStateView($messages, {
    currentConversation: state.currentConversation,
    sources: state.currentConversationSources,
    messageState,
    onSelectSourceConversation: selectSourceConversation,
  });
}

function stageTitle(type) {
  return STAGE_DEFINITIONS[type]?.title || type;
}

function artifactTitle(type) {
  return state.artifactDefinitions[type]?.title || type;
}

function getAvailableSnailsForCurrentConversation() {
  if (!state.currentConversation) return [];
  const names = Array.isArray(state.currentConversation.participating_snails)
    ? state.currentConversation.participating_snails
    : [];
  return names
    .map((name) => state.snails.find((item) => item.name === name))
    .filter((snail) => snail?.name !== "Boss Snail")
    .filter(Boolean);
}

function setMentionStatus(message = "", kind = "") {
  $mentionStatus.textContent = message;
  $mentionStatus.className = `mention-status${kind ? ` ${kind}` : ""}`;
}

function hideMentionSuggestions() {
  mentionState.active = false;
  mentionState.start = -1;
  mentionState.end = -1;
  mentionState.query = "";
  mentionState.suggestions = [];
  mentionState.selectedIndex = 0;
  $mentionSuggestions.className = "mention-suggestions";
  $mentionSuggestions.innerHTML = "";
}

function clearInvalidMentionRanges() {
  mentionState.selectedMentions = mentionState.selectedMentions.filter((mention) => {
    const current = $input.value.slice(mention.start, mention.end);
    return current === mention.raw;
  });
}

function renderMentionSuggestions() {
  if (!mentionState.active || !mentionState.suggestions.length) {
    $mentionSuggestions.className = "mention-suggestions";
    $mentionSuggestions.innerHTML = "";
    return;
  }

  $mentionSuggestions.className = "mention-suggestions visible";
  $mentionSuggestions.innerHTML = mentionState.suggestions.map((snail, index) => `
    <button type="button" class="mention-suggestion${index === mentionState.selectedIndex ? " active" : ""}" data-mention-index="${index}">
      <div class="mention-suggestion-title">@${escapeHtml(snail.name)}</div>
      <div class="mention-suggestion-meta">${escapeHtml(snail.description || "")}</div>
    </button>
  `).join("");

  Array.from($mentionSuggestions.querySelectorAll("[data-mention-index]"))
    .forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        applyMentionSuggestion(Number(button.getAttribute("data-mention-index")));
      });
    });
}

function updateMentionComposer() {
  const availableSnails = getAvailableSnailsForCurrentConversation();
  const value = $input.value;
  const caret = $input.selectionStart ?? value.length;
  const mentionStart = value.lastIndexOf("@", caret - 1);

  if (mentionStart === -1) {
    hideMentionSuggestions();
    setMentionStatus(availableSnails.length ? `可 @ ${availableSnails.map((item) => item.name).join(" / ")}` : "");
    return;
  }

  const prefix = value.slice(0, mentionStart);
  if (prefix && !/[\s\n]$/.test(prefix)) {
    hideMentionSuggestions();
    setMentionStatus(availableSnails.length ? `可 @ ${availableSnails.map((item) => item.name).join(" / ")}` : "");
    return;
  }

  const tail = value.slice(mentionStart + 1);
  const segment = tail.split("\n")[0];
  const typedUntilCaret = value.slice(mentionStart + 1, caret);
  const query = typedUntilCaret.trim();
  const matches = availableSnails.filter((snail) => snail.name.toLowerCase().includes(query.toLowerCase()));

  mentionState.active = true;
  mentionState.start = mentionStart;
  mentionState.end = mentionStart + 1 + segment.length;
  mentionState.query = query;
  mentionState.suggestions = matches;
  mentionState.selectedIndex = Math.min(mentionState.selectedIndex, Math.max(matches.length - 1, 0));

  if (matches.length) {
    setMentionStatus("选择一个 snail 作为当前消息目标", "info");
    renderMentionSuggestions();
    return;
  }

  renderMentionSuggestions();
  setMentionStatus(query ? "继续输入或将其作为普通文本发送" : "继续输入以搜索当前 conversation 中可用的 snail", "info");
}

function applyMentionSuggestion(index) {
  const snail = mentionState.suggestions[index];
  if (!snail) return;
  const before = $input.value.slice(0, mentionState.start);
  const after = $input.value.slice(mentionState.end).replace(/^\s*/, "");
  const nextValue = `${before}@${snail.name}${after ? ` ${after}` : " "}`;
  $input.value = nextValue;
  mentionState.selectedMentions = mentionState.selectedMentions.filter((mention) => mention.end <= mentionState.start || mention.start >= mentionState.end);
  mentionState.selectedMentions.push({
    start: before.length,
    end: before.length + `@${snail.name}`.length,
    raw: `@${snail.name}`,
    snail,
  });
  const nextCaret = `${before}@${snail.name} `.length;
  $input.focus();
  $input.setSelectionRange(nextCaret, nextCaret);
  hideMentionSuggestions();
  setMentionStatus(`当前将发给 ${snail.name}`, "info");
}

async function api(method, path, body) {
  const options = { method, headers: {} };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(API + path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || "Request failed");
  }
  return data;
}

function showNotice(message, isError = false) {
  $appNotice.textContent = message;
  $appNotice.style.display = "block";
  $appNotice.style.background = isError ? "#991b1b" : "#1d4ed8";
  clearTimeout(showNotice._timer);
  showNotice._timer = setTimeout(() => {
    $appNotice.style.display = "none";
  }, 2500);
}

function switchPrimaryView(view) {
  state.activePrimaryView = applyPrimaryView(view, {
    appShell: $appShell,
    navProjects: $navProjects,
    navKnowledge: $navKnowledge,
    navSnailDen: $navSnailDen,
    navPrompts: $navPrompts,
    navSkills: $navSkills,
    workspaceMain: $workspaceMain,
    knowledgePanel: $knowledgePanel,
    snailDenPanel: $snailDenPanel,
    promptPanel: $promptPanel,
    skillPanel: $skillPanel,
    viewRelated: $viewRelated,
  });
  document.body.dataset.primaryView = state.activePrimaryView;
  renderTopProjectState();
  if (state.activePrimaryView === "knowledge") knowledgeCenter.load().catch((err) => showNotice(`加载知识中心失败：${err.message}`, true));
  if (state.activePrimaryView === "snail-den") snailDenController.render(document.getElementById("snail-den-content"));
}

function setReplyTarget(record) {
  state.replyToMessage = record ? {
    id: record.id,
    speaker: messageSpeaker(record),
    preview: summarizeRecord(record).slice(0, 120),
  } : null;
  renderReplyBanner();
}

function renderReplyBanner() {
  if (!state.replyToMessage) {
    $replyBanner.className = "reply-banner";
    $replyBannerText.textContent = "";
    return;
  }
  $replyBanner.className = "reply-banner visible";
  $replyBannerText.innerHTML = `<strong>回复 ${escapeHtml(state.replyToMessage.speaker)}</strong> ${escapeHtml(state.replyToMessage.preview || "(空消息)")}`;
}

function jumpToMessage(messageId) {
  const node = $messages.querySelector(`[data-message-id="${messageId}"]`);
  if (!node) return;
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.classList.add("jump-highlight");
  setTimeout(() => node.classList.remove("jump-highlight"), 2200);
}

function renderProjects() {
  workspaceContext.renderProjectSummary();
  renderProjectTree($projectList, {
    state,
    stageTitle,
    escapeHtml,
    renderFeatureList,
    handlers: { selectProject, selectFeature, selectConversation, archiveFeature, createFeature, createConversation },
  });
}

function renderFeatures() {
  renderProjects();
}

function renderConversations() {
  renderProjects();
}

function renderKnowledgeContext(knowledgeState) {
  if (!$knowledgePendingCount) return;
  $knowledgePendingCount.textContent = String(knowledgeState?.candidates?.length ?? 0);
}

function renderHeader() {
  if (!state.currentProject) {
    renderTopProjectState();
    renderStageActions();
    workspaceContext.renderProjectSummary();
    workspaceContext.renderContextRail();
    return;
  }
  const stageLabel = state.currentStage ? stageTitle(state.currentStage.type) : "无阶段";
  const featureLabel = state.currentFeature ? state.currentFeature.title : "未选择 Feature";
  renderTopProjectState({ featureLabel, stageLabel });
  renderStageActions();
  workspaceContext.renderProjectSummary();
  workspaceContext.renderContextRail();
}

function renderTopProjectState(input = {}) {
  if (!$topProjectState) return;
  if (state.activePrimaryView === "prompts") {
    $topProjectState.textContent = "Prompt Center";
    return;
  }
  if (state.activePrimaryView === "knowledge") {
    $topProjectState.textContent = state.currentProject ? `知识中心 · ${state.currentProject.name}` : "知识中心";
    return;
  }
  if (state.activePrimaryView === "snail-den") { $topProjectState.textContent = snailDenController.topStateText(); return; }
  if (state.activePrimaryView === "skills") { $topProjectState.textContent = "Skill Center"; return; }
  if (!state.currentProject) {
    $topProjectState.textContent = "未选择项目";
    return;
  }
  const featureLabel = input.featureLabel || state.currentFeature?.title || "未选择 Feature";
  const stageLabel = input.stageLabel || (state.currentStage ? stageTitle(state.currentStage.type) : "无阶段");
  $topProjectState.textContent = `${state.currentProject.name} · ${featureLabel} · ${stageLabel}`;
}

function renderStages() {
  $stageList.innerHTML = "";
  if (state.stages.length === 0) {
    $stageList.innerHTML = '<div class="empty-state">暂无阶段</div>';
    workspaceContext.renderContextRail();
    return;
  }
  state.stages.forEach((stage) => {
    const card = document.createElement("div");
    card.className = "stage-card" + (state.currentStage && stage.id === state.currentStage.id ? " active" : "");
    const formal = Array.isArray(stage.formal_artifacts) ? stage.formal_artifacts.length : 0;
    const badge = stage.boss_pending_count > 0 ? `<span class="pending-badge">@${stage.boss_pending_count}</span>` : "";
    card.innerHTML = `
      <div class="name" style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><span>${escapeHtml(stageTitle(stage.type))} #${stage.sequence}</span>${badge}</div>
      <div class="badge ${escapeHtml(stage.status)}">${escapeHtml(stage.status)}</div>
      <div class="meta" style="margin-top: 8px;">正式交付数: ${formal}</div>
    `;
    card.addEventListener("click", async () => {
      state.currentStage = stage;
      await loadStageConversations(stage.id);
      await loadStageArtifacts(stage.id);
      renderHeader();
      renderStages();
      renderArtifactTypeOptions();
      workspaceContext.renderContextRail();
    });
    $stageList.appendChild(card);
  });
  renderStageContract();
  workspaceContext.renderContextRail();
}

function renderStageActions() {
  applyFeatureReadonlyState({
    elements: {
      input: $input,
      send: $send,
      newConversation: document.getElementById("new-conversation-btn"),
      createArtifact: $createArtifact,
      setFormalArtifact: $setFormalArtifact,
      nextStage: $nextStage,
      restartDevelopment: $restartDevelopment,
    },
    state,
    canRestartFeatureDevelopment,
  });
  renderRepoContextCardView({ card: $repoContextCard, editButton: $repoContextEdit, feature: state.currentFeature, readonly: isCurrentFeatureArchived(), escapeHtml });
  renderRepoContextCardView({ card: $repoContextSummaryCard, feature: state.currentFeature, readonly: isCurrentFeatureArchived(), escapeHtml });
}

function renderStageContract() {
  renderStageContractView($stageContract, { currentStage: state.currentStage, definitions: STAGE_DEFINITIONS, snails: state.snails, stageTitle, escapeHtml });
}

function renderArtifactTypeOptions() {
  renderArtifactTypeOptionsView({ artifactTypeSelect: $artifactType, currentStage: state.currentStage, definitions: STAGE_DEFINITIONS, artifactTitle, readonly: isCurrentFeatureArchived() });
}

function renderArtifacts() {
  renderArtifactsView({ artifactList: $artifactList, artifacts: state.artifacts, currentStage: state.currentStage, artifactDefinitions: state.artifactDefinitions, selectedFormalArtifactIds: state.selectedFormalArtifactIds, artifactTitle, escapeHtml, readonly: isCurrentFeatureArchived(), onRendered: () => workspaceContext.renderContextRail() });
}
function renderDispatchState() { renderDispatchStateView($dispatchStateList, state.dispatchState, state.currentConversation, escapeHtml); }
function renderBossMentionsBanner() { renderBossMentionsBannerView($bossMentionsBanner, state.activeBossMentions || [], jumpToMessage, escapeHtml); }
async function loadProjects() {
  state.projects = await api("GET", "/projects");
  renderProjects();
  if (!state.currentProject && state.projects.length > 0) {
    await selectProject(state.projects[0].id);
  }
}

async function selectProject(projectId) {
  state.conversationSelectionToken += 1;
  state.currentProject = await api("GET", `/projects/${projectId}`);
  state.features = state.currentProject.features || [];
  state.currentFeature = state.features.find((feature) => feature.status === "active" || feature.status === "in_review") || state.features.find((feature) => feature.status !== "archived") || state.features[0] || null;
  renderProjects();
  renderFeatures();
  if (state.currentFeature) {
    await selectFeature(state.currentFeature.id);
  } else {
    state.stages = [];
    state.currentStage = null;
    state.conversations = [];
    state.currentConversation = null;
    state.artifacts = [];
    renderActiveMessages();
    renderConversations();
    renderArtifacts();
    workspaceContext.renderContextRail();
  }
  renderHeader();
}

async function selectFeature(featureId) {
  state.conversationSelectionToken += 1;
  state.currentFeature = await api("GET", `/features/${featureId}`);
  state.features = state.features.map((feature) => feature.id === state.currentFeature.id ? state.currentFeature : feature);
  state.stages = state.currentFeature.stages || [];
  state.currentStage = state.currentFeature.current_stage || state.stages.find((stage) => stage.status === "in_progress") || state.stages[state.stages.length - 1] || null;
  renderFeatures();
  renderStages();
  renderArtifactTypeOptions();
  if (state.currentStage) {
    await loadStageConversations(state.currentStage.id);
    await loadStageArtifacts(state.currentStage.id);
  } else {
    state.conversations = [];
    state.currentConversation = null;
    state.artifacts = [];
    renderActiveMessages();
    renderConversations();
    renderArtifacts();
  }
  renderHeader();
}

async function loadStageConversations(stageId, options = {}) {
  state.conversations = await api("GET", `/stages/${stageId}/conversations`);
  renderConversations();
  const current = state.currentConversation && state.conversations.find((conversation) => conversation.id === state.currentConversation.id);
  const preferred = options.preferredConversationId
    ? state.conversations.find((conversation) => conversation.id === options.preferredConversationId)
    : null;
  if (current) {
    await selectConversation(current.id);
  } else if (preferred) {
    await selectConversation(preferred.id);
  } else if (state.conversations[0]) {
    await selectConversation(state.conversations[0].id);
  } else {
    state.conversationSelectionToken += 1;
    state.currentConversation = null;
    renderActiveMessages();
    renderHeader();
    workspaceContext.renderContextRail();
  }
}

async function refreshConversationBadges() {
  if (!state.currentStage) return;
  const latest = await api("GET", `/stages/${state.currentStage.id}/conversations`);
  state.conversations = latest;
  if (state.currentConversation) {
    state.currentConversation = latest.find((conversation) => conversation.id === state.currentConversation.id) || state.currentConversation;
  }
  renderConversations();
  renderHeader();
  workspaceContext.renderContextRail();
}

function applyConversationBadgeUpdate(payload) {
  const index = state.conversations.findIndex((conversation) => conversation.id === payload.conversation_id);
  if (index === -1) return;
  state.conversations[index] = {
    ...state.conversations[index],
    boss_pending_count: payload.boss_pending_count,
  };
  if (state.currentConversation?.id === payload.conversation_id) {
    state.currentConversation = state.conversations[index];
  }
  renderConversations();
  renderHeader();
  workspaceContext.renderContextRail();
}

async function loadStageArtifacts(stageId) {
  state.artifacts = await api("GET", `/stages/${stageId}/artifacts`);
  state.selectedFormalArtifactIds = new Set((state.currentStage && state.currentStage.formal_artifacts) || []);
  renderArtifacts();
  workspaceContext.renderContextRail();
}

async function loadMessages(conversationId, selectionToken = state.conversationSelectionToken) {
  return messageSync.loadMessages(conversationId, selectionToken);
}

function reconcileMessagesAfterStreaming(conversationId) {
  if (!conversationId || state.currentConversation?.id !== conversationId) return;
  loadMessages(conversationId).catch(() => {});
}

function connectWS(conversationId) {
  return messageSync.connect(conversationId);
}

async function selectConversation(conversationId) {
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  state.currentConversation = state.conversations.find((conversation) => conversation.id === conversationId) || null;
  state.currentConversationSources = [];
  state.replyToMessage = null;
  state.activeBossMentions = [];
  getMessageStore(conversationId);
  renderReplyBanner();
  renderBossMentionsBanner();
  renderConversations();
  renderHeader();
  renderActiveMessages();
  workspaceContext.renderContextRail();
  if (!state.currentConversation) return;
  if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return;
  const sources = await loadConversationSources(state.currentConversation);
  if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return;
  state.currentConversationSources = sources;
  const activeBossMentions = await api("POST", `/conversations/${conversationId}/boss-mentions/ack`, {});
  if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return;
  state.activeBossMentions = activeBossMentions;
  const loaded = await loadMessages(conversationId, selectionToken);
  if (!loaded || selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return;
  connectWS(conversationId);
  hideMentionSuggestions();
  updateMentionComposer();
  renderBossMentionsBanner();
  renderDispatchState();
}

async function loadConversationSources(conversation) {
  if (!conversation?.from_conversation_ids?.length) return [];
  const sources = await Promise.all(conversation.from_conversation_ids.map(async (sourceId) => {
    try {
      return await api("GET", `/conversations/${sourceId}`);
    } catch {
      return null;
    }
  }));
  return sources.filter(Boolean);
}

async function selectSourceConversation(conversationId) {
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  const conversation = await api("GET", `/conversations/${conversationId}`);
  if (selectionToken !== state.conversationSelectionToken) return;
  const stage = state.stages.find((item) => item.id === conversation.stage_id) || await api("GET", `/stages/${conversation.stage_id}`);
  if (selectionToken !== state.conversationSelectionToken) return;
  state.currentStage = stage;
  await loadStageConversations(stage.id, { preferredConversationId: conversation.id });
  await loadStageArtifacts(stage.id);
  renderStages();
  renderArtifactTypeOptions();
  renderHeader();
}

async function createProject() {
  const name = prompt("项目名称")?.trim();
  if (!name) return;
  const summary = prompt("项目摘要（可选）") || "";
  state.currentProject = null;
  await api("POST", "/projects", { name, summary });
  await loadProjects();
}

async function createFeature() {
  if (!state.currentProject) return;
  const title = prompt("Feature 标题")?.trim();
  if (!title) return;
  const summary = prompt("Feature 摘要（可选）") || "";
  const result = await api("POST", `/projects/${state.currentProject.id}/features`, { title, summary });
  const refreshedProject = await api("GET", `/projects/${state.currentProject.id}`);
  state.currentProject = refreshedProject;
  state.features = refreshedProject.features || [];
  renderProjects();
  renderFeatures();
  await selectFeature(result.feature.id);
}

async function archiveFeature(featureId) {
  const feature = state.features.find((item) => item.id === featureId);
  if (!feature || feature.status === "archived") return;
  if (!globalThis.confirm(`归档 Feature「${feature.title}」？归档后会收纳到下方“已归档”分组。`)) return;
  const archiveResult = await api("POST", `/features/${featureId}/archive`, {});
  const archivedFeature = archiveResult.feature || archiveResult;
  const refreshedProject = await api("GET", `/projects/${state.currentProject.id}`);
  state.currentProject = refreshedProject;
  state.features = refreshedProject.features || [];
  state.currentFeature = state.currentFeature?.id === featureId
    ? state.features.find((item) => item.status === "active" || item.status === "in_review") || state.features.find((item) => item.status !== "archived") || archivedFeature
    : state.features.find((item) => item.id === state.currentFeature?.id) || state.currentFeature;
  renderProjects();
  renderFeatures();
  if (state.currentFeature) await selectFeature(state.currentFeature.id);
  showNotice(buildArchiveCleanupNotice(archiveResult.cleanup));
}

async function editRepoContext() {
  if (isCurrentFeatureArchived()) return;
  await editFeatureRepoContext({
    feature: state.currentFeature,
    api,
    onUpdated(updatedFeature) {
      state.currentFeature = { ...state.currentFeature, ...updatedFeature };
      state.features = state.features.map((feature) => feature.id === updatedFeature.id ? { ...feature, ...updatedFeature } : feature);
      renderFeatures();
      renderHeader();
    },
    showNotice,
  });
}

async function createConversation() {
  if (isCurrentFeatureArchived()) return;
  if (!state.currentProject || !state.currentFeature || !state.currentStage) return;
  const title = prompt("对话标题")?.trim();
  if (!title) return;
  await api("POST", `/features/${state.currentFeature.id}/stages/${state.currentStage.id}/conversations`, {
    project_id: state.currentProject.id,
    title,
    kind: "discussion",
    from_conversation_ids: state.currentConversation ? [state.currentConversation.id] : [],
  });
  await loadStageConversations(state.currentStage.id);
}

async function createArtifact() {
  if (isCurrentFeatureArchived()) return;
  if (!state.currentConversation || !state.currentStage) return;
  if (!$artifactType.value) return;
  const inlineContent = $artifactContent.value.trim();
  await api("POST", `/conversations/${state.currentConversation.id}/artifacts`, {
    artifact_type: $artifactType.value,
    inline_content: inlineContent,
  });
  $artifactContent.value = "";
  await loadStageArtifacts(state.currentStage.id);
}

async function setFormalArtifacts() {
  if (isCurrentFeatureArchived()) return;
  if (!state.currentStage) return;
  try {
    const updatedStage = await api("PUT", `/stages/${state.currentStage.id}/formal-artifacts`, {
      artifact_ids: Array.from(state.selectedFormalArtifactIds),
    });
    state.currentStage = updatedStage;
    state.stages = state.stages.map((stage) => stage.id === updatedStage.id ? updatedStage : stage);
    renderStages();
    renderArtifacts();
    renderHeader();
    workspaceContext.renderContextRail();
    showNotice("已更新本阶段的正式交付产物");
  } catch (err) {
    showNotice(`设置正式交付失败：${err.message}`, true);
  }
}

async function createNextStage() {
  if (isCurrentFeatureArchived()) return;
  if (!state.currentFeature || !state.currentStage) return;
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  const result = await api("POST", `/features/${state.currentFeature.id}/advance`, {});

  state.stages = state.stages.map((stage) =>
    stage.id === result.completed_stage.id ? result.completed_stage : stage
  );
  if (result.next_stage) state.stages.push(result.next_stage);
  state.currentStage = result.next_stage || result.completed_stage;

  state.conversations = result.conversation ? [result.conversation] : [];
  state.currentConversation = result.conversation;
  if (result.conversation) getMessageStore(result.conversation.id).reset(result.conversation.id);
  state.artifacts = [];
  state.selectedFormalArtifactIds = new Set();

  state.currentFeature = await api("GET", `/features/${result.feature.id}`);
  state.features = state.features.map((feature) => feature.id === state.currentFeature.id ? state.currentFeature : feature);

  renderProjects();
  renderFeatures();
  renderStages();
  renderConversations();
  renderArtifacts();
  renderArtifactTypeOptions();
  renderHeader();
  workspaceContext.renderContextRail();

  if (!result.conversation) return;
  await loadMessages(result.conversation.id, selectionToken);
  if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== result.conversation.id) return;
  connectWS(result.conversation.id);
}

async function restartDevelopmentCycle() {
  if (isCurrentFeatureArchived()) return;
  if (!canRestartFeatureDevelopment(state.currentFeature, state.currentStage)) return;
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  const result = await api("POST", `/features/${state.currentFeature.id}/restart-development`, { stage_id: state.currentStage.id });

  state.stages = state.stages.map((stage) =>
    stage.id === result.completed_stage.id ? result.completed_stage : stage
  );
  state.stages.push(result.next_stage);
  state.currentStage = result.next_stage;

  state.conversations = [result.conversation];
  state.currentConversation = result.conversation;
  getMessageStore(result.conversation.id).reset(result.conversation.id);
  state.artifacts = [];
  state.selectedFormalArtifactIds = new Set();

  state.currentFeature = await api("GET", `/features/${result.feature.id}`);
  state.features = state.features.map((feature) => feature.id === state.currentFeature.id ? state.currentFeature : feature);

  renderProjects();
  renderFeatures();
  renderStages();
  renderConversations();
  renderArtifacts();
  renderArtifactTypeOptions();
  renderHeader();
  workspaceContext.renderContextRail();
  showNotice("已开启全新研发迭代");

  await loadMessages(result.conversation.id, selectionToken);
  if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== result.conversation.id) return;
  connectWS(result.conversation.id);
}

async function send() {
  const content = $input.value.trim();
  if (isCurrentFeatureArchived()) return;
  if (!content || !state.currentConversation) return;
  const conversationId = state.currentConversation.id;
  const store = getMessageStore(conversationId);
  if (hasRunningAssistantMessage(store)) return;
  clearInvalidMentionRanges();
  const events = buildComposerEvents();
  const replyToMessageId = state.replyToMessage?.id ?? null;
  const clientId = createClientId();
  store.addOptimisticMessage({
    clientId,
    role: "user",
    from_snail: "Boss Snail",
    quoted_message_id: replyToMessageId,
    conversation_id: conversationId,
    created_at: new Date().toISOString(),
    events,
  });
  $input.value = "";
  mentionState.selectedMentions = [];
  hideMentionSuggestions();
  setMentionStatus("");
  setReplyTarget(null);
  $send.disabled = true;
  if (realtime.send(conversationId, { type: "send_message", client_id: clientId, events, from_snail: "Boss Snail", quoted_message_id: replyToMessageId })) {
    return;
  }
  try {
    await api("POST", `/conversations/${conversationId}/messages`, { client_id: clientId, events, from_snail: "Boss Snail", quoted_message_id: replyToMessageId });
    await loadMessages(conversationId);
    await refreshConversationBadges();
  } catch (err) {
    store.markOptimisticError(clientId, err.message);
    showNotice(`发送失败：${err.message}`, true);
  }
  $send.disabled = false;
}

async function sendStructuredResponse(content, payload) {
  if (isCurrentFeatureArchived()) return;
  if (!state.currentConversation) return;
  const conversationId = state.currentConversation.id;
  const store = getMessageStore(conversationId);
  if (hasRunningAssistantMessage(store)) return;
  const replyToMessageId = state.replyToMessage?.id ?? null;
  const clientId = createClientId();
  store.addOptimisticMessage({
    clientId,
    role: "user",
    from_snail: "Boss Snail",
    quoted_message_id: replyToMessageId,
    conversation_id: conversationId,
    created_at: new Date().toISOString(),
    events: [{ kind: "content_block", payload: { blocks: payload.blocks || [], fallback_text: payload.fallback_text || null } }],
  });
  setReplyTarget(null);
  $send.disabled = true;
  try {
    if (realtime.send(conversationId, {
      type: "send_message",
      client_id: clientId,
      events: [{ kind: "content_block", payload: { blocks: payload.blocks || [], fallback_text: payload.fallback_text || null } }],
      from_snail: "Boss Snail",
      quoted_message_id: replyToMessageId,
    })) {
      return;
    } else {
      await api("POST", `/conversations/${conversationId}/messages`, {
        client_id: clientId,
        events: [{ kind: "content_block", payload: { blocks: payload.blocks || [], fallback_text: payload.fallback_text || null } }],
        from_snail: "Boss Snail",
        quoted_message_id: replyToMessageId,
      });
      await loadMessages(conversationId);
    }
    await refreshConversationBadges();
  } catch (err) {
    store.markOptimisticError(clientId, err.message);
    showNotice(`提交回答失败：${err.message}`, true);
  }
  $send.disabled = false;
}

function buildComposerEvents() { return buildComposerEventsFromState($input.value, mentionState.selectedMentions); }

document.getElementById("new-project-btn").addEventListener("click", createProject);
$directoryToggle.addEventListener("click", () => {
  $directorySwitcher.classList.toggle("is-collapsed");
  $directoryChevron.textContent = $directorySwitcher.classList.contains("is-collapsed") ? "▾" : "▴";
});
$navProjects.addEventListener("click", () => switchPrimaryView("projects"));
$navKnowledge.addEventListener("click", () => switchPrimaryView("knowledge"));
$navSnailDen.addEventListener("click", () => switchPrimaryView("snail-den"));
$navPrompts.addEventListener("click", () => switchPrimaryView("prompts"));
$navSkills.addEventListener("click", () => switchPrimaryView("skills"));
$knowledgeLibrary.addEventListener("click", () => knowledgeCenter.load("library").catch((err) => showNotice(`加载知识库失败：${err.message}`, true)));
$knowledgeCandidates.addEventListener("click", () => knowledgeCenter.load("candidates").catch((err) => showNotice(`加载待治理候选失败：${err.message}`, true)));
$knowledgeProject.addEventListener("click", () => {
  if (!state.currentProject) return showNotice("请先选择项目", true);
  return knowledgeCenter.loadProjectKnowledge(state.currentProject.id).catch((err) => showNotice(`加载项目知识失败：${err.message}`, true));
});
document.getElementById("create-artifact-btn").addEventListener("click", createArtifact);
document.getElementById("set-formal-artifact-btn").addEventListener("click", setFormalArtifacts);
document.getElementById("next-stage-btn").addEventListener("click", createNextStage);
$restartDevelopment.addEventListener("click", restartDevelopmentCycle);
$repoContextEdit.addEventListener("click", editRepoContext);
workspaceContext.bindInspectorEvents();
$send.addEventListener("click", send);
$input.addEventListener("input", updateMentionComposer);
$input.addEventListener("input", clearInvalidMentionRanges);
bindComposerKeyboard($input, { isMentionActive: () => mentionState.active && mentionState.suggestions.length, moveMentionSelection: (delta) => { mentionState.selectedIndex = (mentionState.selectedIndex + delta + mentionState.suggestions.length) % mentionState.suggestions.length; renderMentionSuggestions(); }, applyMentionSelection: () => applyMentionSuggestion(mentionState.selectedIndex), hideMentionSuggestions, setMentionStatus, send });
$input.addEventListener("click", updateMentionComposer);
$input.addEventListener("focus", updateMentionComposer);
$replyCancel.addEventListener("click", () => setReplyTarget(null));

(async function init() {
  try {
    STAGE_DEFINITIONS = await api("GET", "/meta/stages");
    state.artifactDefinitions = await api("GET", "/meta/artifacts");
    promptCenter.setPrompts(await api("GET", "/meta/prompts"));
    skillCenter.setSkills(await api("GET", "/meta/skills"));
    state.snails = await api("GET", "/snails");
    await snailDenController.load();
    switchPrimaryView(state.activePrimaryView);
    await loadProjects();
  } catch (err) {
    showNotice(`初始化失败：${err.message}`, true);
  }
  $input.focus();
})();
