import { escapeHtml, summarizeRecord, messageSpeaker } from "./message-view.js";
import { renderBossMentionsBanner as renderBossMentionsBannerView } from "./boss-mentions-view.js";
import { MessageList } from "./components/message-list.js";
import { Composer } from "./components/composer.js";
import { WorkspaceTree } from "./components/workspace-tree.js";
import { createPromptCenter } from "./prompt-library.js";
import { createSkillCenter } from "./skill-center-view.js";
import { createMessageSyncController } from "./message-sync-controller.js";
import { createRealtimeManager } from "./realtime-manager.js";
import { renderFeatureList } from "./feature-list-view.js";
import { renderWorkspaceTreeView } from "./workspace-tree-view.js";
import { canRestartFeatureDevelopment } from "./feature-workflow-state.js";
import { createWorkspaceContext } from "./workspace-context.js";
import { getRunningAssistantMessage, hasRunningAssistantMessage } from "./send-availability.js";
import { applyFeatureReadonlyState, isFeatureArchived } from "./feature-readonly-state.js";
import { buildComposerEvents as buildComposerEventsFromState, createClientId } from "./composer-events.js";
import { createInterruptController } from "./interrupt-control.js";
import { bindComposerKeyboard } from "./composer-keyboard.js";
import { createEvolutionCenter } from "./evolution-center.js";
import { createEvolutionConversation } from "./evolution-conversation.js";
import { applyPrimaryView } from "./primary-view.js";
import { mountUiShell } from "./ui-shell.js";
import { editRepoContext as editFeatureRepoContext, renderRepoContextCard as renderRepoContextCardView } from "./repo-context-view.js";
import { renderConversationSourceEmptyState as renderConversationSourceEmptyStateView } from "./conversation-source-empty-state.js";
import { createSnailDenController } from "./snail-den-controller.js";
import { buildArchiveCleanupNotice } from "./archive-cleanup-notice.js";
import { createWorkspaceConfigController } from "./workspace-config-view.js";
import { createLobbyController } from "./lobby-controller.js";
import { createMcpCenter } from "./mcp-center-view.js";
import { createKnowledgeLibraryView } from "./knowledge-library-view.js";

const API = "/api";

const $appRoot = document.getElementById("app-root");
mountUiShell($appRoot);

const state = {
  workspaces: [], currentWorkspace: null,
  features: [], currentFeature: null,
  stages: [], currentStage: null,
  conversations: [], currentConversation: null,
  currentConversationSources: [],
  snails: [],
  conversationSelectionToken: 0,
  activeBossMentions: [],
  activePrimaryView: "workspaces",
  workspaceConfigDraft: null,
};

const $workspaceList = document.getElementById("workspace-list");
const $workspaceConfigPage = document.getElementById("workspace-config-page");
const $messages = document.getElementById("messages");
const $bossMentionsBanner = document.getElementById("boss-mentions-banner");
const $input = document.getElementById("input");
const $send = document.getElementById("send-btn");
const $topWorkspaceState = document.getElementById("top-workspace-state");
const $workspaceSummaryCard = document.getElementById("workspace-summary-card");
const $appNotice = document.getElementById("app-notice");
const $workspaceProgressCard = document.getElementById("stage-summary-card");
const $mentionStatus = document.getElementById("mention-status"), $mentionSuggestions = document.getElementById("mention-suggestions");
const $replyBanner = document.getElementById("reply-banner"), $replyBannerText = document.getElementById("reply-banner-text"), $replyCancel = document.getElementById("reply-cancel");
const $navWorkspaces = document.getElementById("nav-workspaces"), $navEvolution = document.getElementById("nav-evolution"), $navKnowledge = document.getElementById("nav-knowledge"), $navSnailDen = document.getElementById("nav-snail-den"), $navPrompts = document.getElementById("nav-prompts"), $navSkills = document.getElementById("nav-skills"), $navMcps = document.getElementById("nav-mcps"), $navLobby = document.getElementById("nav-lobby");
const $workspaceMain = document.getElementById("workspace-main"), $evolutionPanel = document.getElementById("evolution-panel"), $knowledgePanel = document.getElementById("knowledge-panel"), $snailDenPanel = document.getElementById("snail-den-panel"), $promptPanel = document.getElementById("prompt-panel"), $skillPanel = document.getElementById("skill-panel"), $mcpPanel = document.getElementById("mcp-panel"), $lobbyPanel = document.getElementById("lobby-panel");
const $workspaceConfigPanel = document.getElementById("workspace-config-panel");
const $promptCenterPage = document.getElementById("prompt-center-page");
const $skillCenterPage = document.getElementById("skill-center-page");
const $appShell = document.querySelector(".app-shell");
const $sidebarToggle = document.querySelector(".sidebar-toggle");
const $sidebar = document.querySelector(".sidebar");
const $sidebarBackdrop = document.querySelector(".sidebar-backdrop");

/**
 * ResizeObserver: expose the current layout tier as a data-layout attribute
 * on <html> so JS-side logic (future scroll anchoring, dynamic font sizing,
 * panel toggles) can read the current breakpoint without re-implementing
 * the CSS media query logic.
 *
 * Thresholds align with tokens.css @media breakpoints:
 *   full    >= 1400px (default 3-column)
 *   medium  1100–1399px (2-column: sidebar + main)
 *   narrow  < 1100px (2-column: icon rail + main)
 *   compact < 700px  (reserved for future mobile-first use)
 */
new ResizeObserver(() => {
  const w = document.documentElement.clientWidth;
  const layout = w >= 1400 ? 'full' : w >= 1100 ? 'medium' : w >= 700 ? 'narrow' : 'compact';
  document.documentElement.dataset.layout = layout;
}).observe(document.documentElement);
const $viewRelated = document.querySelectorAll("[data-view-related]");
const $directorySwitcher = document.getElementById("directory-switcher"), $directoryToggle = document.getElementById("directory-toggle"), $directoryChevron = document.getElementById("directory-chevron");
const $evolutionSummary = document.getElementById("evolution-summary"), $evolutionList = document.getElementById("evolution-list"), $evolutionDetail = document.getElementById("evolution-detail");
const $evolutionPendingCount = document.getElementById("evolution-pending-count");
const $evolutionLibrary = document.getElementById("evolution-library-btn"), $evolutionCandidates = document.getElementById("evolution-candidates-btn"), $evolutionWorkspace = document.getElementById("evolution-workspace-btn"), $newEvolutionItem = document.getElementById("new-evolution-item-btn");

const composer = new Composer(
  {
    input: $input,
    send: $send,
    mentionStatus: $mentionStatus,
    mentionSuggestions: $mentionSuggestions,
    replyBanner: $replyBanner,
    replyBannerText: $replyBannerText,
    replyCancel: $replyCancel,
    interruptBtn: document.getElementById("interrupt-btn"),
  },
  {
    getAvailableRoles: () => getAvailableRolesForCurrentConversation(),
    isArchived: () => isCurrentFeatureArchived(),
    escapeHtml,
    messageSpeaker,
    summarizeRecord,
  },
);

const messageList = new MessageList($messages, {
  onSubmitQuestion: sendStructuredResponse,
  isArchived: () => isCurrentFeatureArchived(),
  isInterruptPending: (target) => interruptControl.isPending(target),
  onInterrupt: async (messageId) => {
    const conversationId = state.currentConversation?.id;
    if (!conversationId) return;
    const target = { conversationId, messageId };
    const store = getMessageStore(conversationId);
    const interruptPromise = interruptControl.interrupt(target);
    if (store) messageList.render(store, conversationId);
    await interruptPromise;
    const store2 = getMessageStore(conversationId);
    if (store2) messageList.render(store2, conversationId);
  },
  onPermissionApprove: async (conversationId, messageId) => {
    if (isCurrentFeatureArchived()) return;
    try {
      await api("POST", `/api/conversations/${conversationId}/messages/${messageId}/approve-tool`, { approved: true });
      await loadMessages(conversationId);
      await refreshConversationBadges();
    } catch (err) {
      showNotice(`审批失败: ${err.message}`, true);
    }
  },
  onPermissionDeny: async (conversationId, messageId) => {
    if (isCurrentFeatureArchived()) return;
    try {
      await api("POST", `/api/conversations/${conversationId}/messages/${messageId}/approve-tool`, { approved: false });
      await loadMessages(conversationId);
    } catch (err) {
      showNotice(`拒绝失败: ${err.message}`, true);
    }
  },
  onLoadMore: loadMoreMessages,
});

const snailDenController = createSnailDenController({ api, showNotice });

const workspaceContext = createWorkspaceContext({
  elements: {
    workspaceSummaryCard: $workspaceSummaryCard,
    workspaceProgressCard: $workspaceProgressCard,
  },
  state,
  stageTitle,
  escapeHtml,
  api,
  renderRepoContextCard: renderRepoContextCardView,
  onEditRepoContext: editRepoContext,
  onAdvanceStage: createNextStage,
  onBounceStage: bounceStage,
  canRestartFeatureDevelopment,
  isReadonly: isCurrentFeatureArchived,
  getTemplates: () => snailDenController.getTemplates(),
  showNotice,
});

const workspaceTree = new WorkspaceTree(
  {
    workspaceList: $workspaceList,
    topWorkspaceState: $topWorkspaceState,
    workspaceSummaryCard: $workspaceSummaryCard,
    stageSummaryCard: $workspaceProgressCard,
    bossMentionsBanner: $bossMentionsBanner,
  },
  {
    state,
    renderWorkspaceTreeView,
    renderFeatureList,
    stageTitle,
    escapeHtml,
    workspaceContext,
    snailDenController,
  },
);

const promptCenter = createPromptCenter({ root: $promptCenterPage });
const skillCenter = createSkillCenter({ root: $skillCenterPage });
const $mcpCenterPage = document.getElementById("mcp-center-page");
const mcpCenter = createMcpCenter({ root: $mcpCenterPage });

const interruptControl = createInterruptController({
  api,
  isArchived: isCurrentFeatureArchived,
  syncAvailability: syncSendAvailability,
  showNotice,
});

const evolutionConversation = createEvolutionConversation({
  container: $evolutionDetail,
  api,
  showNotice,
});

const evolutionCenter = createEvolutionCenter({
  api,
  elements: { summary: $evolutionSummary, list: $evolutionList, detail: $evolutionDetail },
  getCurrentWorkspace: () => state.currentWorkspace,
  getWorkspaces: () => state.workspaces,
  showNotice,
  onStateChange: renderEvolutionContext,
  onOpenConversation: openEvolutionConversation,
  evolutionConversation,
});

const workspaceConfigController = createWorkspaceConfigController({
  root: $workspaceConfigPage,
  getTemplates: () => snailDenController.getTemplates(),
  escapeHtml,
  onCancel() {
    cancelWorkspaceConfig();
  },
  onSubmit: submitWorkspaceConfig,
  onDetectSnail: detectSnailInDirectory,
});

const lobbyController = createLobbyController({ api, showNotice });
const knowledgeLibraryView = createKnowledgeLibraryView({ api });

function renderMessageStore(store) {
  const conversationId = state.currentConversation?.id || null;
  messageList.render(store, conversationId);
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
    evolutionCenter.renderConversationFromStore(store, conversationId);
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
  loadDispatchState: async () => true,
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
    messageList.clear();
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
  const stage = state.currentStage;
  if (stage && stage.type === type && stage.stage_definition?.title) return stage.stage_definition.title;
  const matchingStage = state.stages.find((s) => s.type === type);
  if (matchingStage?.stage_definition?.title) return matchingStage.stage_definition.title;
  return type;
}

function getAvailableRolesForCurrentConversation() {
  if (!state.currentConversation) return [];
  const names = Array.isArray(state.currentConversation.participating_roles)
    ? state.currentConversation.participating_roles
    : [];
  return names
    .map((name) => state.snails.find((item) => item.name === name))
    .filter((role) => role?.name !== "Boss Role")
    .filter(Boolean);
}

function setMentionStatus(message = "", kind = "") {
  composer.setMentionStatus(message, kind);
}

function hideMentionSuggestions() {
  composer.hideMentionSuggestions();
}

function clearInvalidMentionRanges() {
  composer.clearInvalidMentionRanges();
}

function updateMentionComposer() {
  composer.updateMentionComposer();
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
    navWorkspaces: $navWorkspaces,
    navEvolution: $navEvolution,
    navKnowledge: $navKnowledge,
    navSnailDen: $navSnailDen,
    navPrompts: $navPrompts,
    navSkills: $navSkills,
    navMcps: $navMcps,
    navLobby: $navLobby,
    workspaceMain: $workspaceMain,
    workspaceConfigPanel: $workspaceConfigPanel,
    evolutionPanel: $evolutionPanel,
    knowledgePanel: $knowledgePanel,
    snailDenPanel: $snailDenPanel,
    promptPanel: $promptPanel,
    skillPanel: $skillPanel,
    mcpPanel: $mcpPanel,
    lobbyPanel: $lobbyPanel,
    viewRelated: $viewRelated,
  });
  document.body.dataset.primaryView = state.activePrimaryView;
  renderTopWorkspaceState();
  if (state.activePrimaryView === "evolution") evolutionCenter.load().catch((err) => showNotice(`加载 Evolution Center 失败：${err.message}`, true));
  if (state.activePrimaryView === "knowledge") knowledgeLibraryView.load().catch((err) => showNotice(`加载知识库失败：${err.message}`, true));
  if (state.activePrimaryView === "snail-den") snailDenController.render(document.getElementById("snail-den-content"));
  if (state.activePrimaryView === "mcps") api("GET", "/meta/mcps").then((mcps) => mcpCenter.setMcps(mcps)).catch((err) => showNotice(`加载 MCP 列表失败：${err.message}`, true));
  if (state.activePrimaryView === "lobby") lobbyController.load().then(() => lobbyController.render(document.getElementById("lobby-page")));
}

function setReplyTarget(record) {
  composer.setReplyTarget(record);
}

function jumpToMessage(messageId) {
  messageList.jumpTo(messageId);
}

function renderWorkspaces() {
  workspaceTree.renderTree({
    selectWorkspace,
    selectFeature,
    selectConversation,
    archiveFeature,
    createFeature,
    createConversation,
    reloadSnailConfig,
  });
}

async function reloadSnailConfig() {
  if (!state.currentWorkspace) return;
  try {
    await api("POST", `/workspaces/${state.currentWorkspace.id}/load-snail`);
    await selectWorkspace(state.currentWorkspace.id);
    showNotice("已从 .snail 目录重新加载配置");
  } catch (err) {
    showNotice(`加载失败：${err.message}`, true);
  }
}

function renderWorkspaceDetail() {
  const isConfiguring = state.activePrimaryView === "workspace-config";
  $bossMentionsBanner.hidden = isConfiguring;
  if (isConfiguring) workspaceConfigController.render();
}

function renderFeatures() {
  renderWorkspaces();
}

function renderConversations() {
  renderWorkspaces();
}

function renderEvolutionContext(evolutionState) {
  if (!$evolutionPendingCount) return;
  $evolutionPendingCount.textContent = String(evolutionState?.items?.length ?? 0);
}

/**
 * Open the governance conversation within the Evolution view.
 * Selects the workspace/feature in the background to update internal state,
 * then opens the conversation panel in-place without switching primary view.
 */
async function openEvolutionConversation({ featureId, conversationId }) {
  try {
    await selectWorkspace("evolution-center");
    await selectFeature(featureId, { preferredConversationId: conversationId });
    evolutionCenter.openConversation(featureId, conversationId);
    connectEvolutionRealtime(conversationId);
  } catch (err) {
    showNotice(`打开对话失败：${err.message}`, true);
  }
}

function connectEvolutionRealtime(conversationId) {
  getMessageStore(conversationId);
  messageSync.connect(conversationId);
}

function renderHeader() {
  renderWorkspaceDetail();
  if (state.activePrimaryView === "workspace-config") {
    renderTopWorkspaceState();
    workspaceContext.renderWorkspaceSummary();
    workspaceContext.renderContextRail();
    return;
  }
  if (!state.currentWorkspace) {
    renderTopWorkspaceState();
    renderStageActions();
    workspaceContext.renderWorkspaceSummary();
    workspaceContext.renderContextRail();
    return;
  }
  const stageLabel = state.currentStage ? stageTitle(state.currentStage.type) : "无阶段";
  const featureLabel = state.currentFeature ? state.currentFeature.title : "未选择 Feature";
  renderTopWorkspaceState({ featureLabel, stageLabel });
  renderStageActions();
  workspaceContext.renderWorkspaceSummary();
  workspaceContext.renderContextRail();
}

function renderTopWorkspaceState(input = {}) {
  workspaceTree.renderTopState(input);
}

function renderStages() {
  if (state.stages.length === 0) {
    workspaceContext.renderContextRail();
    return;
  }
  workspaceContext.renderContextRail();
}

function renderStageActions() {
  applyFeatureReadonlyState({
    elements: {
      input: $input,
      send: $send,
      newConversation: document.getElementById("new-conversation-btn"),
    },
    state,
    canRestartFeatureDevelopment,
  });
}

function startWorkspaceConfig() {
  state.workspaceConfigDraft = workspaceConfigController.start();
  state.currentWorkspace = null;
  state.features = [];
  state.currentFeature = null;
  state.stages = [];
  state.currentStage = null;
  state.conversations = [];
  state.currentConversation = null;
  switchPrimaryView("workspace-config");
  renderWorkspaces();
  renderHeader();
}

function cancelWorkspaceConfig() {
  state.workspaceConfigDraft = null;
  switchPrimaryView("workspaces");
  renderHeader();
}

function extractRoleBindings(draft) {
  const bindings = {};
  const devStage = (draft.stage_definitions || []).find((s) => s.key === "development");
  const revStage = (draft.stage_definitions || []).find((s) => s.key === "review");
  if (devStage) {
    const primary = devStage.roles.find((r) => r.is_primary) || devStage.roles[0];
    if (primary?.snail_template_id) bindings.developer = primary.snail_template_id;
  }
  if (revStage) {
    const reviewer = revStage.roles.find((r) => !r.is_primary) || revStage.roles[revStage.roles.length - 1];
    if (reviewer?.snail_template_id) bindings.reviewer = reviewer.snail_template_id;
  }
  return bindings;
}

async function detectSnailInDirectory({ workspaceRoot, error }) {
  if (error) {
    showNotice(error, true);
    return { has_snail: false };
  }
  try {
    const result = await api("POST", "/workspaces/detect-snail", { workspace_root: workspaceRoot });
    if (result.has_snail) {
      showNotice("已检测到 .snail 目录，将从文件加载配置");
    } else {
      showNotice("未检测到 .snail 目录，将使用手动配置");
    }
    return result;
  } catch (err) {
    showNotice(`检测失败：${err.message}`, true);
    return { has_snail: false };
  }
}

async function submitWorkspaceConfig(draft, validationError) {
  // 如果没有检测到 .snail 目录，需要验证 stage 配置（用于生成默认 .snail 结构）
  if (!draft.has_snail && validationError) { showNotice(validationError, true); return; }
  if (!draft.has_snail && !snailDenController.getTemplates().length) { showNotice("Snail Den 没有可用 template，无法绑定 role 执行者", true); return; }
  try {
    const payload = {
      name: draft.name,
      summary: draft.summary,
      workspace_root: draft.workspace_root,
      role_bindings: draft.has_snail ? {} : extractRoleBindings(draft),
      load_from_snail: true, // 始终从 .snail 加载，如果不存在则初始化默认结构
    };
    const result = await api("POST", "/workspaces", payload);
    state.workspaceConfigDraft = null;
    workspaceConfigController.clear();
    await loadWorkspaces();
    switchPrimaryView("workspaces");
    await selectWorkspace(result.workspace.id);
    showNotice(draft.has_snail ? "工作区已创建并从 .snail 目录加载配置" : "工作区已创建并初始化 .snail 目录");
  } catch (err) {
    showNotice(`创建工作区失败：${err.message}`, true);
  }
}

function renderBossMentionsBanner() { renderBossMentionsBannerView($bossMentionsBanner, state.activeBossMentions || [], jumpToMessage, escapeHtml); }
async function loadWorkspaces() {
  state.workspaces = await api("GET", "/workspaces");
  renderWorkspaces();
  if (state.activePrimaryView === "workspace-config") return;
  if (!state.currentWorkspace && state.workspaces.length > 0) {
    await selectWorkspace(state.workspaces[0].id);
  }
}

async function selectWorkspace(workspaceId) {
  state.conversationSelectionToken += 1;
  state.currentWorkspace = await api("GET", `/workspaces/${workspaceId}`);
  state.features = state.currentWorkspace.features || [];
  state.currentFeature = state.features.find((feature) => feature.current_stage && feature.current_stage.status === "in_progress") || state.features.find((feature) => !feature.closed_at) || state.features[0] || null;
  renderWorkspaces();
  renderFeatures();
  if (state.currentFeature) {
    await selectFeature(state.currentFeature.id);
  } else {
    state.stages = [];
    state.currentStage = null;
    state.conversations = [];
    state.currentConversation = null;
    renderActiveMessages();
    renderConversations();
    workspaceContext.renderContextRail();
  }
  renderHeader();
}

async function selectFeature(featureId, options = {}) {
  state.conversationSelectionToken += 1;
  state.currentFeature = await api("GET", `/features/${featureId}`);
  state.features = state.features.map((feature) => feature.id === state.currentFeature.id ? state.currentFeature : feature);
  state.stages = state.currentFeature.stages || [];
  state.currentStage = state.currentFeature.current_stage || state.stages.find((stage) => stage.status === "in_progress") || state.stages[state.stages.length - 1] || null;
  renderFeatures();
  renderStages();
  if (state.currentStage) {
    await loadStageConversations(state.currentStage.id, { preferredConversationId: options.preferredConversationId });
  } else {
    state.conversations = [];
    state.currentConversation = null;
    renderActiveMessages();
    renderConversations();
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

async function loadMessages(conversationId, selectionToken = state.conversationSelectionToken) {
  return messageSync.loadMessages(conversationId, selectionToken);
}

async function reconcileMessagesAfterStreaming(conversationId) {
  if (!conversationId || state.currentConversation?.id !== conversationId) return;
  /* Keep hasMore in sync — recent limit matches the initial load limit. */
  const store = getMessageStore(conversationId);
  if (store) store.setHasMore(store.getState().records.length >= 20);
}

async function loadMoreMessages() {
  const conversationId = state.currentConversation?.id;
  if (!conversationId) return 0;
  try {
    return await messageSync.loadOlderMessages(conversationId);
  } catch {
    return 0;
  }
}

function connectWS(conversationId) {
  return messageSync.connect(conversationId);
}

async function selectConversation(conversationId) {
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  state.currentConversation = state.conversations.find((conversation) => conversation.id === conversationId) || null;
  state.currentConversationSources = [];
  composer.clearReplyTarget();
  state.activeBossMentions = [];
  getMessageStore(conversationId);
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
  messageList.scrollToBottom();
  const loaded = await loadMessages(conversationId, selectionToken);
  if (!loaded || selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return;
  connectWS(conversationId);
  hideMentionSuggestions();
  updateMentionComposer();
  renderBossMentionsBanner();
  workspaceContext.renderContextRail();
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
  renderStages();
  renderHeader();
}

async function createFeature() {
  if (!state.currentWorkspace) return;
  const title = prompt("Feature 标题")?.trim();
  if (!title) return;
  const summary = prompt("Feature 摘要（可选）") || "";
  const result = await api("POST", `/workspaces/${state.currentWorkspace.id}/features`, { title, summary });
  const refreshedWorkspace = await api("GET", `/workspaces/${state.currentWorkspace.id}`);
  state.currentWorkspace = refreshedWorkspace;
  state.features = refreshedWorkspace.features || [];
  renderWorkspaces();
  renderFeatures();
  await selectFeature(result.feature.id);
}

async function archiveFeature(featureId) {
  const feature = state.features.find((item) => item.id === featureId);
  if (!feature || feature.closed_at) return;
  if (!globalThis.confirm(`归档 Feature「${feature.title}」？归档后会收纳到下方“已归档”分组。`)) return;
  const archiveResult = await api("POST", `/features/${featureId}/archive`, {});
  const archivedFeature = archiveResult.feature || archiveResult;
  const refreshedWorkspace = await api("GET", `/workspaces/${state.currentWorkspace.id}`);
  state.currentWorkspace = refreshedWorkspace;
  state.features = refreshedWorkspace.features || [];
  state.currentFeature = state.currentFeature?.id === featureId
    ? state.features.find((item) => item.current_stage && item.current_stage.status === "in_progress") || state.features.find((item) => !item.closed_at) || archivedFeature
    : state.features.find((item) => item.id === state.currentFeature?.id) || state.currentFeature;
  renderWorkspaces();
  renderFeatures();
  if (state.currentFeature) await selectFeature(state.currentFeature.id);
  showNotice(buildArchiveCleanupNotice(archiveResult.cleanup));
}

async function editRepoContext() {
  if (isCurrentFeatureArchived()) return;
  await editFeatureRepoContext({
    stage: state.currentStage,
    showNotice,
  });
}

async function createConversation() {
  if (isCurrentFeatureArchived()) return;
  if (!state.currentWorkspace || !state.currentFeature || !state.currentStage) return;
  const title = prompt("对话标题")?.trim();
  if (!title) return;
  await api("POST", `/features/${state.currentFeature.id}/stages/${state.currentStage.id}/conversations`, {
    workspace_id: state.currentWorkspace.id,
    title,
    kind: "discussion",
    from_conversation_ids: state.currentConversation ? [state.currentConversation.id] : [],
  });
  await loadStageConversations(state.currentStage.id);
}

async function createNextStage() {
  if (isCurrentFeatureArchived()) return;
  if (!state.currentFeature || !state.currentStage) return;
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  let result;
  try {
    result = await api("POST", `/features/${state.currentFeature.id}/advance`, {});
  } catch (err) {
    showNotice(`推进失败：${err.message}`, true);
    return;
  }

  state.stages = state.stages.map((stage) =>
    stage.id === result.completed_stage.id ? result.completed_stage : stage
  );
  if (result.next_stage) state.stages.push(result.next_stage);
  state.currentStage = result.next_stage || result.completed_stage;

  state.conversations = result.conversation ? [result.conversation] : [];
  state.currentConversation = result.conversation;
  if (result.conversation) getMessageStore(result.conversation.id).reset(result.conversation.id);

  state.currentFeature = await api("GET", `/features/${result.feature.id}`);
  state.features = state.features.map((feature) => feature.id === state.currentFeature.id ? state.currentFeature : feature);

  renderWorkspaces();
  renderFeatures();
  renderStages();
  renderConversations();
  renderHeader();
  workspaceContext.renderContextRail();

  if (!result.conversation) return;
  await loadMessages(result.conversation.id, selectionToken);
  if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== result.conversation.id) return;
  connectWS(result.conversation.id);
}

async function bounceStage() {
  if (isCurrentFeatureArchived()) return;
  if (!canRestartFeatureDevelopment(state.currentFeature, state.currentStage)) return;
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  let result;
  try {
    result = await api("POST", `/features/${state.currentFeature.id}/bounce-stage`, { stage_id: state.currentStage.id });
  } catch (err) {
    showNotice(`阶段回退失败：${err.message}`, true);
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

  state.currentFeature = await api("GET", `/features/${result.feature.id}`);
  state.features = state.features.map((feature) => feature.id === state.currentFeature.id ? state.currentFeature : feature);

  renderWorkspaces();
  renderFeatures();
  renderStages();
  renderConversations();
  renderHeader();
  workspaceContext.renderContextRail();
  showNotice("已回退到前序阶段");

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
  const replyToMessageId = composer.getReplyTarget()?.id ?? null;
  const clientId = createClientId();
  store.addOptimisticMessage({
    clientId,
    role: "user",
    from_role: "Boss Role",
    quoted_message_id: replyToMessageId,
    conversation_id: conversationId,
    created_at: new Date().toISOString(),
    events,
  });
  composer.clear();
  $send.disabled = true;
  if (realtime.send(conversationId, { type: "send_message", client_id: clientId, events, from_role: "Boss Role", quoted_message_id: replyToMessageId })) {
    return;
  }
  try {
    await api("POST", `/conversations/${conversationId}/messages`, { client_id: clientId, events, from_role: "Boss Role", quoted_message_id: replyToMessageId });
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
  const replyToMessageId = composer.getReplyTarget()?.id ?? null;
  const clientId = createClientId();
  store.addOptimisticMessage({
    clientId,
    role: "user",
    from_role: "Boss Role",
    quoted_message_id: replyToMessageId,
    conversation_id: conversationId,
    created_at: new Date().toISOString(),
    events: [{ kind: "content_block", payload: { blocks: payload.blocks || [], fallback_text: payload.fallback_text || null } }],
  });
  composer.clearReplyTarget();
  $send.disabled = true;
  try {
    if (realtime.send(conversationId, {
      type: "send_message",
      client_id: clientId,
      events: [{ kind: "content_block", payload: { blocks: payload.blocks || [], fallback_text: payload.fallback_text || null } }],
      from_role: "Boss Role",
      quoted_message_id: replyToMessageId,
    })) {
      return;
    } else {
      await api("POST", `/conversations/${conversationId}/messages`, {
        client_id: clientId,
        events: [{ kind: "content_block", payload: { blocks: payload.blocks || [], fallback_text: payload.fallback_text || null } }],
        from_role: "Boss Role",
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

function buildComposerEvents() { return buildComposerEventsFromState($input.value, composer.mentionState.selectedMentions); }

document.getElementById("new-workspace-btn").addEventListener("click", startWorkspaceConfig);
$directoryToggle.addEventListener("click", () => {
  $directorySwitcher.classList.toggle("is-collapsed");
  $directoryChevron.textContent = $directorySwitcher.classList.contains("is-collapsed") ? "▾" : "▴";
});
$navWorkspaces.addEventListener("click", () => switchPrimaryView("workspaces"));
$navEvolution.addEventListener("click", () => switchPrimaryView("evolution"));
$navKnowledge.addEventListener("click", () => switchPrimaryView("knowledge"));
$navSnailDen.addEventListener("click", () => switchPrimaryView("snail-den"));
$navPrompts.addEventListener("click", () => switchPrimaryView("prompts"));
$navSkills.addEventListener("click", () => switchPrimaryView("skills"));
$navMcps.addEventListener("click", () => switchPrimaryView("mcps"));
$navLobby.addEventListener("click", () => switchPrimaryView("lobby"));
$evolutionLibrary.addEventListener("click", () => evolutionCenter.load("list").catch((err) => showNotice(`加载演进工作区失败：${err.message}`, true)));
$evolutionCandidates.addEventListener("click", () => evolutionCenter.load("list").catch((err) => showNotice(`加载演进工作区失败：${err.message}`, true)));
$evolutionWorkspace.addEventListener("click", () => {
  if (!state.currentWorkspace) return showNotice("请先选择工作区", true);
  return evolutionCenter.loadWorkspaceEvolution(state.currentWorkspace.id).catch((err) => showNotice(`加载工作区演进中心失败：${err.message}`, true));
});
$newEvolutionItem.addEventListener("click", () => evolutionCenter.startCreate());
$send.addEventListener("click", send);
$input.addEventListener("input", updateMentionComposer);
$input.addEventListener("input", clearInvalidMentionRanges);
bindComposerKeyboard($input, { isMentionActive: () => composer.isMentionActive(), moveMentionSelection: (delta) => composer.moveMentionSelection(delta), applyMentionSelection: () => composer.applyMentionSelection(), hideMentionSuggestions, setMentionStatus, send });
$input.addEventListener("click", updateMentionComposer);
$input.addEventListener("focus", updateMentionComposer);
$replyCancel.addEventListener("click", () => setReplyTarget(null));

/** Sidebar toggle for narrow widths: show/hide workspace tree as floating overlay */
function closeSidebar() {
  $sidebar.classList.remove("is-expanded");
}

$sidebarToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  $sidebar.classList.toggle("is-expanded");
});

$sidebarBackdrop.addEventListener("click", closeSidebar);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $sidebar.classList.contains("is-expanded")) {
    closeSidebar();
    e.stopPropagation();
  }
});

(async function init() {
  try {
    promptCenter.setPrompts(await api("GET", "/meta/prompts"));
    skillCenter.setSkills(await api("GET", "/meta/skills"));
    const [roleDefinitions] = await Promise.all([api("GET", "/roles"), snailDenController.load()]);
    state.snails = roleDefinitions;
    switchPrimaryView(state.activePrimaryView);
    await loadWorkspaces();
  } catch (err) {
    showNotice(`初始化失败：${err.message}`, true);
  }
  $input.focus();
})();
