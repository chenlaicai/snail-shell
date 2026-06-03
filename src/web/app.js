import { escapeHtml, summarizeRecord, messageSpeaker } from "./message-view.js";
import { MessageList } from "./components/message-list.js";
import { Composer } from "./components/composer.js";
import { WorkspaceTree } from "./components/workspace-tree.js";
import { createPromptCenter } from "./prompt-library.js";
import { createSkillCenter } from "./skill-center-view.js";
import { createMessageSyncController } from "./message-sync-controller.js";
import { createRealtimeManager } from "./realtime-manager.js";
import { renderIssueList } from "./issue-list-view.js";
import { renderWorkspaceTreeView } from "./workspace-tree-view.js";
import { canTransitionFrom } from "./issue-workflow-state.js";
import { createWorkspaceContext } from "./workspace-context.js";
import { getRunningAssistantMessage } from "./send-availability.js";
import { createInterruptController } from "./interrupt-control.js";
import { bindComposerKeyboard } from "./composer-keyboard.js";
import { createEvolutionCenter } from "./evolution-center.js";
import { createEvolutionConversation } from "./evolution-conversation.js";
import { applyPrimaryView } from "./primary-view.js";
import { mountUiShell } from "./ui-shell.js";
import { renderRepoContextCard as renderRepoContextCardView } from "./repo-context-view.js";
import { renderConversationSourceEmptyState as renderConversationSourceEmptyStateView } from "./conversation-source-empty-state.js";
import { createSnailDenController } from "./snail-den-controller.js";
import { createWorkspaceConfigController } from "./workspace-config-view.js";
import { createLobbyController } from "./lobby-controller.js";
import { createMcpCenter } from "./mcp-center-view.js";
import { createKnowledgeLibraryView } from "./knowledge-library-view.js";
import { api } from "./api-client.js";
import { createConversationController } from "./conversation-controller.js";
import { createWorkspaceController } from "./workspace-controller.js";
import { createStageController } from "./stage-controller.js";

const $appRoot = document.getElementById("app-root");
mountUiShell($appRoot);

const state = {
  workspaces: [], currentWorkspace: null,
  issues: [], currentIssue: null,
  stages: [], currentStage: null,
  conversations: [], currentConversation: null,
  currentConversationSources: [],
  currentSopTransitions: [],
  snails: [],
  conversationSelectionToken: 0,
  activeBossMentions: [],
  activePrimaryView: "workspaces",
  workspaceConfigDraft: null,
};

const $workspaceList = document.getElementById("workspace-list");
const $workspaceConfigPage = document.getElementById("workspace-config-page");
const $messages = document.getElementById("messages"), $bossMentionsBanner = document.getElementById("boss-mentions-banner"), $input = document.getElementById("input"), $send = document.getElementById("send-btn");
const $topWorkspaceState = document.getElementById("top-workspace-state"), $workspaceSummaryCard = document.getElementById("workspace-summary-card"), $appNotice = document.getElementById("app-notice"), $workspaceProgressCard = document.getElementById("stage-summary-card");
const $mentionStatus = document.getElementById("mention-status"), $mentionSuggestions = document.getElementById("mention-suggestions");
const $replyBanner = document.getElementById("reply-banner"), $replyBannerText = document.getElementById("reply-banner-text"), $replyCancel = document.getElementById("reply-cancel");
const $navWorkspaces = document.getElementById("nav-workspaces"), $navEvolution = document.getElementById("nav-evolution"), $navKnowledge = document.getElementById("nav-knowledge"), $navSnailDen = document.getElementById("nav-snail-den"), $navPrompts = document.getElementById("nav-prompts"), $navSkills = document.getElementById("nav-skills"), $navMcps = document.getElementById("nav-mcps"), $navLobby = document.getElementById("nav-lobby");
const $workspaceMain = document.getElementById("workspace-main"), $evolutionPanel = document.getElementById("evolution-panel"), $knowledgePanel = document.getElementById("knowledge-panel"), $snailDenPanel = document.getElementById("snail-den-panel"), $promptPanel = document.getElementById("prompt-panel"), $skillPanel = document.getElementById("skill-panel"), $mcpPanel = document.getElementById("mcp-panel"), $lobbyPanel = document.getElementById("lobby-panel");
const $workspaceConfigPanel = document.getElementById("workspace-config-panel"), $promptCenterPage = document.getElementById("prompt-center-page"), $skillCenterPage = document.getElementById("skill-center-page");
const $appShell = document.querySelector(".app-shell");
const $sidebarToggle = document.querySelector(".sidebar-toggle");
const $sidebar = document.querySelector(".sidebar");
const $sidebarBackdrop = document.querySelector(".sidebar-backdrop");

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

const conversationController = createConversationController({
  api,
  state,
  composer: null,
  messageList: null,
  realtime: null,
  messageSync: null,
  elements: { $input, $send, $bossMentionsBanner },
});

const stageController = createStageController({
  api,
  state,
  escapeHtml,
  showNotice: null,
  elements: { $input, $send },
  canTransitionFrom,
});

const snailDenController = createSnailDenController({ api, showNotice: null });

const workspaceContext = createWorkspaceContext({
  elements: {
    workspaceSummaryCard: $workspaceSummaryCard,
    workspaceProgressCard: $workspaceProgressCard,
  },
  state,
  stageTitle: null,
  escapeHtml,
  api,
  renderRepoContextCard: renderRepoContextCardView,
  onEditRepoContext: null,
  onAdvanceStage: null,
  onBounceStage: null,
  canTransitionFrom,
  transitions: state.currentSopTransitions,
  isReadonly: null,
  getTemplates: () => snailDenController.getTemplates(),
  showNotice: null,
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
    renderIssueList,
    stageTitle: null,
    escapeHtml,
    workspaceContext,
    snailDenController,
  },
);

const workspaceController = createWorkspaceController({
  api,
  state,
  workspaceTree,
  workspaceContext,
  workspaceConfigController: null,
  snailDenController,
  showNotice: null,
  switchPrimaryView: null,
});

const promptCenter = createPromptCenter({ root: $promptCenterPage });
const skillCenter = createSkillCenter({ root: $skillCenterPage });
const $mcpCenterPage = document.getElementById("mcp-center-page");
const mcpCenter = createMcpCenter({ root: $mcpCenterPage });

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
    isArchived: () => isCurrentIssueArchived(),
    escapeHtml,
    messageSpeaker,
    summarizeRecord,
  },
);

const messageList = new MessageList($messages, {
  onSubmitQuestion: conversationController.sendStructuredResponse,
  isArchived: () => isCurrentIssueArchived(),
  isInterruptPending: (target) => interruptControl.isPending(target),
  onInterrupt: async (messageId) => {
    const conversationId = state.currentConversation?.id;
    if (!conversationId) return;
    const target = { conversationId, messageId };
    const store = conversationController.getMessageStore(conversationId);
    const interruptPromise = interruptControl.interrupt(target);
    if (store) messageList.render(store, conversationId);
    await interruptPromise;
    const store2 = conversationController.getMessageStore(conversationId);
    if (store2) messageList.render(store2, conversationId);
  },
  onPermissionApprove: async (conversationId, messageId) => {
    if (isCurrentIssueArchived()) return;
    try {
      await api("POST", `/api/conversations/${conversationId}/messages/${messageId}/approve-tool`, { approved: true });
      await conversationController.loadMessages(conversationId);
      await conversationController.refreshConversationBadges();
    } catch (err) {
      showNotice(`审批失败: ${err.message}`, true);
    }
  },
  onPermissionDeny: async (conversationId, messageId) => {
    if (isCurrentIssueArchived()) return;
    try {
      await api("POST", `/api/conversations/${conversationId}/messages/${messageId}/approve-tool`, { approved: false });
      await conversationController.loadMessages(conversationId);
    } catch (err) {
      showNotice(`拒绝失败: ${err.message}`, true);
    }
  },
  onLoadMore: () => conversationController.loadMoreMessages(),
});

const interruptControl = createInterruptController({
  api,
  isArchived: isCurrentIssueArchived,
  syncAvailability: syncSendAvailability,
  showNotice: null,
});

const evolutionConversation = createEvolutionConversation({
  container: $evolutionDetail,
  api,
  showNotice: null,
});

const evolutionCenter = createEvolutionCenter({
  api,
  elements: { summary: $evolutionSummary, list: $evolutionList, detail: $evolutionDetail },
  getCurrentWorkspace: () => state.currentWorkspace,
  getWorkspaces: () => state.workspaces,
  showNotice: null,
  onStateChange: renderEvolutionContext,
  onOpenConversation: openEvolutionConversation,
  evolutionConversation,
});

const workspaceConfigController = createWorkspaceConfigController({
  root: $workspaceConfigPage,
  getTemplates: () => snailDenController.getTemplates(),
  escapeHtml,
  onCancel() {
    workspaceController.cancelWorkspaceConfig();
  },
  onSubmit: (draft, validationError) => workspaceController.submitWorkspaceConfig(draft, validationError),
  onDetectSnail: (args) => workspaceController.detectSnailInDirectory(args),
});

const lobbyController = createLobbyController({ api, showNotice: null });
const knowledgeLibraryView = createKnowledgeLibraryView({ api });

function showNotice(message, isError = false) {
  $appNotice.textContent = message;
  $appNotice.style.display = "block";
  $appNotice.style.background = isError ? "#991b1b" : "#1d4ed8";
  clearTimeout(showNotice._timer);
  showNotice._timer = setTimeout(() => {
    $appNotice.style.display = "none";
  }, 2500);
}

function isCurrentIssueArchived() {
  return state.currentIssue?.closed_at != null;
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
    $send.disabled = isCurrentIssueArchived();
    return;
  }
  const store = conversationController.getMessageStore(conversationId);
  const runningMessage = getRunningAssistantMessage(store);
  $send.disabled = isCurrentIssueArchived() || Boolean(runningMessage);
  interruptControl.clearIfNot(runningMessage ? { conversationId, messageId: runningMessage.id } : null);
  if (state.currentConversation?.id === conversationId) renderActiveMessageStore(store);
}

function renderConversationSourceEmptyState(messageState) {
  renderConversationSourceEmptyStateView($messages, {
    currentConversation: state.currentConversation,
    sources: state.currentConversationSources,
    messageState,
    onSelectSourceConversation: (conversationId) => workspaceController.selectSourceConversation?.(conversationId),
  });
}

function renderActiveMessages() {
  const conversationId = state.currentConversation?.id;
  if (conversationId) {
    const store = conversationController.getMessageStore(conversationId);
    if (store) {
      renderActiveMessageStore(store);
      syncSendAvailability(conversationId);
      return;
    }
  }
  messageList.clear();
  $send.disabled = isCurrentIssueArchived();
  interruptControl.clearIfNot(null);
}

function renderEvolutionContext(evolutionState) {
  if (!$evolutionPendingCount) return;
  $evolutionPendingCount.textContent = String(evolutionState?.items?.length ?? 0);
}

async function openEvolutionConversation({ issueId, conversationId }) {
  try {
    await workspaceController.selectWorkspace("evolution-center");
    await workspaceController.selectIssue(issueId, { preferredConversationId: conversationId });
    evolutionCenter.openConversation(issueId, conversationId);
    conversationController.getMessageStore(conversationId);
    conversationController.connectWS(conversationId);
  } catch (err) {
    showNotice(`打开对话失败：${err.message}`, true);
  }
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
    conversationController.refreshConversationBadges().catch(() => {});
  },
  onMessageEventAppended(conversationId, eventId) {
    messageSync.updateCursor(conversationId, eventId);
  },
  onMessageStatusChanged(conversationId) {
    conversationController.reconcileMessagesAfterStreaming(conversationId);
    conversationController.refreshConversationBadges().catch(() => {});
    syncSendAvailability(conversationId);
  },
  onSocketError(conversationId, error, clientId) {
    if (state.currentConversation?.id !== conversationId) return;
    if (clientId) conversationController.getMessageStore(conversationId).markOptimisticError(clientId, error);
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
  onConversationBadge: (payload) => conversationController.applyConversationBadgeUpdate(payload),
});

const messageSync = createMessageSyncController({
  api,
  getMessageStore: (conversationId) => conversationController.getMessageStore(conversationId),
  isActiveConversation: (conversationId) => state.currentConversation?.id === conversationId,
  isCurrentSelection: (conversationId, selectionToken) => selectionToken === state.conversationSelectionToken && state.currentConversation?.id === conversationId,
  loadDispatchState: async () => true,
  realtime,
  syncSendAvailability,
});

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
  workspaceTree.renderTopState();
  if (state.activePrimaryView === "evolution") evolutionCenter.load().catch((err) => showNotice(`加载 Evolution Center 失败：${err.message}`, true));
  if (state.activePrimaryView === "knowledge") knowledgeLibraryView.load().catch((err) => showNotice(`加载知识库失败：${err.message}`, true));
  if (state.activePrimaryView === "snail-den") snailDenController.render(document.getElementById("snail-den-content"));
  if (state.activePrimaryView === "mcps") {
    const workspaceRoot = state.currentWorkspace?.workspace_root;
    const mcpsPath = workspaceRoot ? `/meta/mcps?workspace_root=${encodeURIComponent(workspaceRoot)}` : "/meta/mcps";
    api("GET", mcpsPath).then((mcps) => mcpCenter.setMcps(mcps)).catch((err) => showNotice(`加载 MCP 列表失败：${err.message}`, true));
  }
  if (state.activePrimaryView === "lobby") lobbyController.load().then(() => lobbyController.render(document.getElementById("lobby-page")));
}

function renderWorkspaceDetail() {
  const isConfiguring = state.activePrimaryView === "workspace-config";
  $bossMentionsBanner.hidden = isConfiguring;
  if (isConfiguring) workspaceConfigController.render();
}

/* Wire up cross-controller dependencies. */
conversationController.setup({
  renderConversations: () => workspaceController.renderWorkspaces(),
  renderHeader: () => workspaceController.renderHeader(),
  renderActiveMessages,
});

stageController.setup({
  loadStageConversations: (stageId, options) => conversationController.loadStageConversations(stageId, options),
  refreshIssueAndRender: () => workspaceController.refreshIssueAndRender(),
  getMessageStore: (conversationId) => conversationController.getMessageStore(conversationId),
  loadMessages: (conversationId, selectionToken) => conversationController.loadMessages(conversationId, selectionToken),
  connectWS: (conversationId) => conversationController.connectWS(conversationId),
});

workspaceController.setup({
  loadStageConversations: (stageId, options) => conversationController.loadStageConversations(stageId, options),
  selectConversation: (conversationId) => conversationController.selectConversation(conversationId),
  createConversation: () => conversationController.createConversation(),
  renderActiveMessages,
  renderWorkspaceDetail,
});
workspaceController.setupStageController(stageController);

/* Inject remaining dependencies that require fully-wired controllers. */
const realtimeStore = realtime;
conversationController.realtime = realtimeStore;
conversationController.messageSync = messageSync;
conversationController.composer = composer;
conversationController.messageList = messageList;

snailDenController.showNotice = showNotice;
stageController.showNotice = showNotice;
interruptControl.showNotice = showNotice;
evolutionConversation.showNotice = showNotice;
lobbyController.showNotice = showNotice;
evolutionCenter.showNotice = showNotice;
workspaceContext.showNotice = showNotice;
workspaceController.showNotice = showNotice;
workspaceController.setWorkspaceConfigController(workspaceConfigController);
workspaceContext.stageTitle = (type) => workspaceController.stageTitle(type);
workspaceContext.onEditRepoContext = () => workspaceController.editRepoContext();
workspaceContext.onAdvanceStage = () => stageController.createNextStage();
workspaceContext.onBounceStage = () => stageController.bounceStage();
workspaceContext.isReadonly = isCurrentIssueArchived;
workspaceTree.stageTitle = (type) => workspaceController.stageTitle(type);
workspaceController.switchPrimaryView = switchPrimaryView;

document.getElementById("new-workspace-btn").addEventListener("click", () => workspaceController.startWorkspaceConfig());
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
$send.addEventListener("click", () => conversationController.send());
$input.addEventListener("input", () => composer.updateMentionComposer());
$input.addEventListener("input", () => composer.clearInvalidMentionRanges());
bindComposerKeyboard($input, { isMentionActive: () => composer.isMentionActive(), moveMentionSelection: (delta) => composer.moveMentionSelection(delta), applyMentionSelection: () => composer.applyMentionSelection(), hideMentionSuggestions: () => composer.hideMentionSuggestions(), setMentionStatus: (message, kind) => composer.setMentionStatus(message, kind), send: () => conversationController.send() });
$input.addEventListener("click", () => composer.updateMentionComposer());
$input.addEventListener("focus", () => composer.updateMentionComposer());
$replyCancel.addEventListener("click", () => composer.setReplyTarget(null));

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
    await workspaceController.loadWorkspaces();
  } catch (err) {
    showNotice(`初始化失败：${err.message}`, true);
  }
  $input.focus();
})();
