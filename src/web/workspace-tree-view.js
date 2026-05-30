export function renderWorkspaceTreeView(element, input) {
  const { state, stageTitle, escapeHtml, renderFeatureList, handlers } = input;
  element.innerHTML = "";
  if (state.workspaces.length === 0) {
    element.innerHTML = '<div class="empty-state">暂无工作区</div>';
    return;
  }
  state.workspaces.forEach((workspace) => {
    const isCurrentWorkspace = state.currentWorkspace?.id === workspace.id;
    const workspaceNode = document.createElement("div");
    workspaceNode.className = "tree-workspace-node" + (isCurrentWorkspace ? " active" : "");
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tree-workspace";
    const badge = workspace.boss_pending_count > 0 ? `<span class="pending-badge">@${workspace.boss_pending_count}</span>` : "";
    item.innerHTML = `
      <span>
        <span class="node-header"><span class="node-main"><span class="chevron">${isCurrentWorkspace ? "▾" : "▸"}</span><span class="node-title">${escapeHtml(workspace.name)}</span></span>${badge || `<span class="badge">${escapeHtml(workspace.status)}</span>`}</span>
        <span class="node-meta">${escapeHtml(workspace.module)} · ${escapeHtml(workspace.status)}</span>
      </span>
    `;
    item.addEventListener("click", () => handlers.selectWorkspace(workspace.id));
    workspaceNode.appendChild(item);
    if (isCurrentWorkspace) {
      workspaceNode.appendChild(renderCurrentWorkspaceChildren({ state, stageTitle, escapeHtml, renderFeatureList, handlers }));
    }
    element.appendChild(workspaceNode);
  });
}

export function renderConversationList(conversationList, input) {
  const { state, escapeHtml, onSelectConversation } = input;
  conversationList.innerHTML = "";
  if (!state.currentFeature) {
    conversationList.innerHTML = '<div class="empty-state">先选择一个 Feature</div>';
    return;
  }
  if (state.conversations.length === 0) {
    conversationList.innerHTML = '<div class="empty-state">当前阶段还没有对话</div>';
    return;
  }
  state.conversations.forEach((conversation) => {
    const row = document.createElement("div");
    row.className = "conversation-row" + (state.currentConversation && state.currentConversation.id === conversation.id ? " active" : "");
    const badge = conversation.boss_pending_count > 0 ? `<span class="pending-badge">@${conversation.boss_pending_count}</span>` : "";
    row.innerHTML = `
      <button type="button">
        <span class="node-header"><span class="node-title">${escapeHtml(conversation.title)}</span>${badge}</span>
        <span class="node-meta">${escapeHtml(conversation.default_role)}</span>
      </button>
    `;
    row.querySelector("button").addEventListener("click", () => onSelectConversation(conversation.id));
    conversationList.appendChild(row);
  });
}

function renderCurrentWorkspaceChildren(input) {
  const { state, stageTitle, escapeHtml, renderFeatureList, handlers } = input;
  const children = document.createElement("div");
  children.className = "tree-children";
  const featureTools = document.createElement("div");
  featureTools.className = "tree-feature-tools";
  featureTools.innerHTML = '<button class="secondary-button" id="new-feature-btn" type="button">新建 Feature</button>';
  const featureList = document.createElement("div");
  featureList.className = "feature-list";
  children.append(featureTools, featureList);
  renderFeatureList(featureList, {
    state,
    stageTitle,
    escapeHtml,
    onSelectFeature: handlers.selectFeature,
    onArchiveFeature: handlers.archiveFeature,
    onCreateConversation: handlers.createConversation,
    onSelectConversation: handlers.selectConversation,
    renderConversationList,
  });
  children.querySelector("#new-feature-btn").addEventListener("click", handlers.createFeature);
  return children;
}
