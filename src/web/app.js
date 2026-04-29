import { renderMessages } from "./message-renderer.js";
import { escapeHtml, summarizeRecord, messageSpeaker } from "./message-view.js";
import { renderBossMentionsBanner as renderBossMentionsBannerView } from "./boss-mentions-view.js";
import { createPromptLibrary } from "./prompt-library.js";
import { createRealtimeManager } from "./realtime-manager.js";
import { renderDispatchState as renderDispatchStateView } from "./dispatch-state-view.js";
import { createWorkspaceContext } from "./workspace-context.js";
import { hasRunningAssistantMessage } from "./send-availability.js";
import { renderStageContractView } from "./stage-contract-view.js";

const API = "/api";
let STAGE_DEFINITIONS = {};

const state = {
  projects: [],
  currentProject: null,
  stages: [],
  currentStage: null,
  conversations: [],
  currentConversation: null,
  artifacts: [],
  artifactDefinitions: {},
  snails: [],
  conversationSelectionToken: 0,
  dispatchState: null,
  activeBossMentions: [], selectedFormalArtifactIds: new Set(),
  replyToMessage: null,
};

const $projectList = document.getElementById("project-list");
const $conversationList = document.getElementById("conversation-list");
const $messages = document.getElementById("messages");
const $bossMentionsBanner = document.getElementById("boss-mentions-banner");
const $input = document.getElementById("input");
const $send = document.getElementById("send-btn");
const $conversationTitle = document.getElementById("conversation-title");
const $conversationBreadcrumbs = document.getElementById("conversation-breadcrumbs");
const $workspaceStageBadge = document.getElementById("workspace-stage-badge"), $workspaceNextStep = document.getElementById("workspace-next-step");
const $topProjectState = document.getElementById("top-project-state");
const $projectSummaryCard = document.getElementById("project-summary-card");
const $appNotice = document.getElementById("app-notice");
const $stageList = document.getElementById("stage-list");
const $stageContract = document.getElementById("stage-contract");
const $stageSummaryCard = document.getElementById("stage-summary-card"), $participantsSummaryCard = document.getElementById("participants-summary-card"), $deliverablesSummaryCard = document.getElementById("deliverables-summary-card");
const $artifactList = document.getElementById("artifact-list");
const $artifactType = document.getElementById("artifact-type");
const $artifactTitle = document.getElementById("artifact-title");
const $artifactContent = document.getElementById("artifact-content");
const $promptSearch = document.getElementById("prompt-search");
const $promptTargetFilter = document.getElementById("prompt-target-filter");
const $promptList = document.getElementById("prompt-list");
const $promptDetail = document.getElementById("prompt-detail");
const $dispatchStateList = document.getElementById("dispatch-state-list");
const $mentionStatus = document.getElementById("mention-status");
const $mentionSuggestions = document.getElementById("mention-suggestions");
const $replyBanner = document.getElementById("reply-banner");
const $replyBannerText = document.getElementById("reply-banner-text");
const $replyCancel = document.getElementById("reply-cancel");
const $restartDevelopment = document.getElementById("restart-development-btn");
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

const promptLibrary = createPromptLibrary({
  searchInput: $promptSearch,
  targetFilter: $promptTargetFilter,
  list: $promptList,
  detail: $promptDetail,
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
    workspaceStageBadge: $workspaceStageBadge,
  },
  state,
  getStageDefinitions: () => STAGE_DEFINITIONS,
  stageTitle,
  artifactTitle,
  escapeHtml,
});

function renderMessageStore(store) {
  renderMessages($messages, store.getState(), {
    onReply(messageId) {
      const record = store.getMessageById(messageId);
      if (!record) return;
      setReplyTarget(record);
      $input.focus();
    },
    onSubmitQuestion: sendStructuredResponse,
  });
  $messages.scrollTop = $messages.scrollHeight;
}

function syncSendAvailability(conversationId = state.currentConversation?.id || null) {
  if (!conversationId || state.currentConversation?.id !== conversationId) return;
  const store = getMessageStore(conversationId);
  $send.disabled = hasRunningAssistantMessage(store);
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
  onMessageStatusChanged(conversationId) {
    reconcileMessagesAfterStreaming(conversationId);
    refreshConversationBadges().catch(() => {});
    syncSendAvailability(conversationId);
  },
  onSocketError(conversationId, error) {
    if (state.currentConversation?.id !== conversationId) return;
    showNotice(`Error: ${error}`, true);
    $send.disabled = false;
  },
  onConversationBadge: applyConversationBadgeUpdate,
});

function getMessageStore(conversationId) { return realtime.getStore(conversationId); }

function getActiveMessageStore() {
  return state.currentConversation ? getMessageStore(state.currentConversation.id) : null;
}

function renderActiveMessages() {
  const store = getActiveMessageStore();
  if (store) {
    renderMessageStore(store);
    syncSendAvailability(state.currentConversation?.id || null);
  } else {
    renderMessages($messages, { records: [], byPersistedId: new Map() }, {});
    $send.disabled = false;
  }
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
  $projectList.innerHTML = "";
  workspaceContext.renderProjectSummary();
  if (state.projects.length === 0) {
    $projectList.innerHTML = '<div class="empty-state">暂无项目</div>';
    return;
  }
  state.projects.forEach((project) => {
    const item = document.createElement("div");
    item.className = "nav-item" + (state.currentProject && state.currentProject.id === project.id ? " active" : "");
    const badge = project.boss_pending_count > 0 ? `<span class="pending-badge">@${project.boss_pending_count}</span>` : "";
    item.innerHTML = `
      <button>
        <div class="name" style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><span>${escapeHtml(project.name)}</span>${badge}</div>
        <div class="meta">${escapeHtml(project.kind)} · ${escapeHtml(project.status)}</div>
      </button>
    `;
    item.querySelector("button").addEventListener("click", () => selectProject(project.id));
    $projectList.appendChild(item);
  });
}

function renderConversations() {
  $conversationList.innerHTML = "";
  if (!state.currentProject) {
    $conversationList.innerHTML = '<div class="empty-state">先选择一个项目</div>';
    return;
  }
  if (state.conversations.length === 0) {
    $conversationList.innerHTML = '<div class="empty-state">当前阶段还没有对话</div>';
    return;
  }
  state.conversations.forEach((conversation) => {
    const row = document.createElement("div");
    row.className = "conversation-row" + (state.currentConversation && state.currentConversation.id === conversation.id ? " active" : "");
    const badge = conversation.boss_pending_count > 0 ? `<span class="pending-badge">@${conversation.boss_pending_count}</span>` : "";
    const stageLabel = state.currentStage ? stageTitle(state.currentStage.type) : "无阶段";
    row.innerHTML = `
      <button>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><span>${escapeHtml(conversation.title)}</span>${badge}</div>
        <div class="meta">${escapeHtml(stageLabel)} · ${escapeHtml(conversation.default_snail)}</div>
      </button>
    `;
    row.querySelector("button").addEventListener("click", () => selectConversation(conversation.id));
    $conversationList.appendChild(row);
  });
}

function renderHeader() {
  if (!state.currentProject) {
    $topProjectState.textContent = "未选择项目";
    $conversationTitle.textContent = "未选择对话";
    $conversationBreadcrumbs.textContent = "请选择一个项目。";
    $workspaceStageBadge.textContent = "无活跃阶段";
    $workspaceStageBadge.className = "badge";
    $workspaceNextStep.textContent = workspaceContext.nextStepText();
    renderStageActions();
    workspaceContext.renderProjectSummary();
    workspaceContext.renderContextRail();
    return;
  }
  const stageLabel = state.currentStage ? stageTitle(state.currentStage.type) : "无阶段";
  $topProjectState.textContent = `${state.currentProject.name} · ${stageLabel}`;
  $conversationTitle.textContent = state.currentConversation ? state.currentConversation.title : state.currentProject.name;
  $conversationBreadcrumbs.textContent = state.currentConversation
    ? `${state.currentProject.name} / ${stageLabel} / ${state.currentConversation.default_snail}`
    : `${state.currentProject.name} / ${stageLabel}`;
  $workspaceStageBadge.textContent = state.currentStage ? `${stageLabel} · ${state.currentStage.status}` : "无活跃阶段";
  $workspaceStageBadge.className = "badge" + (state.currentStage ? ` ${state.currentStage.status}` : "");
  $workspaceNextStep.textContent = workspaceContext.nextStepText();
  renderStageActions();
  workspaceContext.renderProjectSummary();
  workspaceContext.renderContextRail();
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
  $restartDevelopment.disabled = !state.currentStage || state.currentStage.status !== "in_progress";
  $restartDevelopment.title = $restartDevelopment.disabled ? "仅当前进行中阶段可开启新研发迭代" : "不要求正式交付，直接开启全新研发迭代";
}

function renderStageContract() {
  renderStageContractView($stageContract, { currentStage: state.currentStage, definitions: STAGE_DEFINITIONS, snails: state.snails, stageTitle, escapeHtml });
}

function renderArtifactTypeOptions() {
  $artifactType.innerHTML = "";
  const types = state.currentStage ? (STAGE_DEFINITIONS[state.currentStage.type]?.formal_artifact_types || []) : [];
  if (types.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "无推荐类型";
    $artifactType.appendChild(option);
    return;
  }
  types.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = artifactTitle(type);
    $artifactType.appendChild(option);
  });
}

function renderArtifacts() {
  $artifactList.innerHTML = "";
  if (!state.currentStage) {
    $artifactList.innerHTML = '<div class="empty-state">未选择阶段</div>';
    workspaceContext.renderContextRail();
    return;
  }
  if (state.artifacts.length === 0) {
    $artifactList.innerHTML = '<div class="empty-state">当前阶段还没有 artifact</div>';
    workspaceContext.renderContextRail();
    return;
  }
  const formalSet = new Set(state.currentStage.formal_artifacts || []);
  state.artifacts.forEach((artifact) => {
    const card = document.createElement("div");
    card.className = "artifact-card";
    const checked = formalSet.has(artifact.id);
    const definition = state.artifactDefinitions[artifact.artifact_type];
    card.innerHTML = `
      <label style="display:flex; gap:8px; align-items:flex-start; cursor:pointer;">
        <input type="checkbox" data-artifact-id="${artifact.id}" ${checked ? "checked" : ""} style="width:auto; margin-top:4px;">
        <div style="flex:1;">
          <div class="name">${escapeHtml(artifact.title)}</div>
          <div class="meta">${escapeHtml(artifactTitle(artifact.artifact_type))} · ${escapeHtml(artifact.status)} · ${escapeHtml(artifact.storage_type)}</div>
          <div class="meta" style="margin-top: 6px;">${escapeHtml(definition?.description || "")}</div>
          <pre>${escapeHtml(artifact.inline_content || artifact.external_ref || artifact.file_path || "")}</pre>
        </div>
      </label>
    `;
    const checkbox = card.querySelector("input[type=checkbox]");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedFormalArtifactIds.add(artifact.id);
      else state.selectedFormalArtifactIds.delete(artifact.id);
    });
    if (checked) state.selectedFormalArtifactIds.add(artifact.id);
    $artifactList.appendChild(card);
  });
  workspaceContext.renderContextRail();
}
function renderDispatchState() {
  renderDispatchStateView($dispatchStateList, state.dispatchState, state.currentConversation, escapeHtml);
}
function renderBossMentionsBanner() {
  renderBossMentionsBannerView($bossMentionsBanner, state.activeBossMentions || [], jumpToMessage, escapeHtml);
}
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
  state.stages = state.currentProject.stages || [];
  state.currentStage = state.stages.find((stage) => stage.status === "in_progress" || stage.status === "in_review") || state.stages[state.stages.length - 1] || null;
  renderProjects();
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
    workspaceContext.renderContextRail();
  }
  renderHeader();
}

async function loadStageConversations(stageId) {
  state.conversations = await api("GET", `/stages/${stageId}/conversations`);
  renderConversations();
  const current = state.currentConversation && state.conversations.find((conversation) => conversation.id === state.currentConversation.id);
  if (current) {
    await selectConversation(current.id);
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
  const messages = await api("GET", `/conversations/${conversationId}/messages/recent?limit=100`);
  if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return false;
  getMessageStore(conversationId).replaceHistory(conversationId, messages);
  syncSendAvailability(conversationId);
  state.dispatchState = await api("GET", `/conversations/${conversationId}/dispatch-state`);
  if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== conversationId) return false;
  renderDispatchState();
  return true;
}

function reconcileMessagesAfterStreaming(conversationId) {
  if (!conversationId || state.currentConversation?.id !== conversationId) return;
  loadMessages(conversationId).catch(() => {});
}
function connectWS(conversationId) { return realtime.connect(conversationId); }

async function selectConversation(conversationId) {
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  state.currentConversation = state.conversations.find((conversation) => conversation.id === conversationId) || null;
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

async function createProject() {
  const name = prompt("项目名称")?.trim();
  if (!name) return;
  const summary = prompt("项目摘要（可选）") || "";
  state.currentProject = null;
  await api("POST", "/projects", { name, summary });
  await loadProjects();
}

async function createConversation() {
  if (!state.currentProject || !state.currentStage) return;
  const title = prompt("对话标题")?.trim();
  if (!title) return;
  await api("POST", `/stages/${state.currentStage.id}/conversations`, {
    project_id: state.currentProject.id,
    title,
    kind: "discussion",
    from_conversation_ids: state.currentConversation ? [state.currentConversation.id] : [],
  });
  await loadStageConversations(state.currentStage.id);
}

async function createArtifact() {
  if (!state.currentConversation || !state.currentStage) return;
  if (!$artifactType.value) return;
  const title = $artifactTitle.value.trim() || $artifactType.value;
  const inlineContent = $artifactContent.value.trim();
  await api("POST", `/conversations/${state.currentConversation.id}/artifacts`, {
    artifact_type: $artifactType.value,
    title,
    inline_content: inlineContent,
  });
  $artifactTitle.value = "";
  $artifactContent.value = "";
  await loadStageArtifacts(state.currentStage.id);
}

async function setFormalArtifacts() {
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
  if (!state.currentProject || !state.currentStage) return;
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  const result = await api("POST", `/projects/${state.currentProject.id}/advance`, {});

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

  const refreshedProject = await api("GET", `/projects/${state.currentProject.id}`);
  state.currentProject = refreshedProject;
  state.projects = state.projects.map((project) =>
    project.id === refreshedProject.id ? { ...project, ...refreshedProject } : project
  );

  renderProjects();
  renderStages();
  renderConversations();
  renderArtifacts();
  renderArtifactTypeOptions();
  renderHeader();
  workspaceContext.renderContextRail();

  await loadMessages(result.conversation.id, selectionToken);
  if (selectionToken !== state.conversationSelectionToken || state.currentConversation?.id !== result.conversation.id) return;
  connectWS(result.conversation.id);
}

async function restartDevelopmentCycle() {
  if (!state.currentProject || !state.currentStage || state.currentStage.status !== "in_progress") return;
  const selectionToken = state.conversationSelectionToken + 1;
  state.conversationSelectionToken = selectionToken;
  const result = await api("POST", `/projects/${state.currentProject.id}/restart-development`, { stage_id: state.currentStage.id });

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

  const refreshedProject = await api("GET", `/projects/${state.currentProject.id}`);
  state.currentProject = refreshedProject;
  state.projects = state.projects.map((project) =>
    project.id === refreshedProject.id ? { ...project, ...refreshedProject } : project
  );

  renderProjects();
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
  if (!content || !state.currentConversation) return;
  const conversationId = state.currentConversation.id;
  const store = getMessageStore(conversationId);
  if (hasRunningAssistantMessage(store)) return;
  clearInvalidMentionRanges();
  const events = buildComposerEvents();
  const replyToMessageId = state.replyToMessage?.id ?? null;
  const clientId = `temp-user-${Date.now()}`;
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
  if (!state.currentConversation) return;
  const conversationId = state.currentConversation.id;
  const store = getMessageStore(conversationId);
  if (hasRunningAssistantMessage(store)) return;
  const replyToMessageId = state.replyToMessage?.id ?? null;
  const clientId = `temp-user-${Date.now()}`;
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

function buildComposerEvents() {
  const value = $input.value;
  const mentions = [...mentionState.selectedMentions].sort((left, right) => left.start - right.start);
  const mentionedSnails = [...new Set(mentions.map((mention) => mention.snail.name))];
  if (!value.trim()) return [];
  return [{
    kind: "text",
    payload: { text: value, mentions: mentionedSnails },
  }];
}

document.getElementById("new-project-btn").addEventListener("click", createProject);
document.getElementById("new-conversation-btn").addEventListener("click", createConversation);
document.getElementById("create-artifact-btn").addEventListener("click", createArtifact);
document.getElementById("set-formal-artifact-btn").addEventListener("click", setFormalArtifacts);
document.getElementById("next-stage-btn").addEventListener("click", createNextStage);
$restartDevelopment.addEventListener("click", restartDevelopmentCycle);
workspaceContext.bindInspectorEvents();
$send.addEventListener("click", send);
$input.addEventListener("input", updateMentionComposer);
$input.addEventListener("input", clearInvalidMentionRanges);
$input.addEventListener("keydown", (event) => {
  if (mentionState.active && mentionState.suggestions.length) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      mentionState.selectedIndex = (mentionState.selectedIndex + 1) % mentionState.suggestions.length;
      renderMentionSuggestions();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      mentionState.selectedIndex = (mentionState.selectedIndex - 1 + mentionState.suggestions.length) % mentionState.suggestions.length;
      renderMentionSuggestions();
      return;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      if (event.key === "Enter" && event.shiftKey) return;
      event.preventDefault();
      applyMentionSuggestion(mentionState.selectedIndex);
      return;
    }
  }
  if (event.key === "Escape") {
    hideMentionSuggestions();
    setMentionStatus("");
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});
$input.addEventListener("click", updateMentionComposer);
$input.addEventListener("focus", updateMentionComposer);
$replyCancel.addEventListener("click", () => setReplyTarget(null));

(async function init() {
  try {
    STAGE_DEFINITIONS = await api("GET", "/meta/stages");
    state.artifactDefinitions = await api("GET", "/meta/artifacts");
    promptLibrary.setPrompts(await api("GET", "/meta/prompts"));
    state.snails = await api("GET", "/snails");
    await loadProjects();
  } catch (err) {
    showNotice(`初始化失败：${err.message}`, true);
  }
  $input.focus();
})();
