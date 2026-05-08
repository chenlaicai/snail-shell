export function renderProjectTree(element, input) {
  const { state, stageTitle, escapeHtml, renderFeatureList, handlers } = input;
  element.innerHTML = "";
  if (state.projects.length === 0) {
    element.innerHTML = '<div class="empty-state">暂无项目</div>';
    return;
  }
  state.projects.forEach((project) => {
    const isCurrentProject = state.currentProject?.id === project.id;
    const projectNode = document.createElement("div");
    projectNode.className = "tree-project-node" + (isCurrentProject ? " active" : "");
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tree-project";
    const badge = project.boss_pending_count > 0 ? `<span class="pending-badge">@${project.boss_pending_count}</span>` : "";
    item.innerHTML = `
      <span>
        <span class="node-header"><span class="node-main"><span class="chevron">${isCurrentProject ? "▾" : "▸"}</span><span class="node-title">${escapeHtml(project.name)}</span></span>${badge || `<span class="badge">${escapeHtml(project.status)}</span>`}</span>
        <span class="node-meta">${escapeHtml(project.kind)} · ${escapeHtml(project.status)}</span>
      </span>
    `;
    item.addEventListener("click", () => handlers.selectProject(project.id));
    projectNode.appendChild(item);
    if (isCurrentProject) {
      projectNode.appendChild(renderCurrentProjectChildren({ state, stageTitle, escapeHtml, renderFeatureList, handlers }));
    }
    element.appendChild(projectNode);
  });
}

export function renderConversationList(conversationList, input) {
  const { state, stageTitle, escapeHtml, onSelectConversation } = input;
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
    const stageLabel = state.currentStage ? stageTitle(state.currentStage.type) : "无阶段";
    row.innerHTML = `
      <button type="button">
        <span class="node-header"><span class="node-title">${escapeHtml(conversation.title)}</span>${badge}</span>
        <span class="node-meta">${escapeHtml(stageLabel)} · ${escapeHtml(conversation.default_snail)}</span>
      </button>
    `;
    row.querySelector("button").addEventListener("click", () => onSelectConversation(conversation.id));
    conversationList.appendChild(row);
  });
}

function renderCurrentProjectChildren(input) {
  const { state, stageTitle, escapeHtml, renderFeatureList, handlers } = input;
  const children = document.createElement("div");
  children.className = "tree-children";
  const featureTools = document.createElement("div");
  featureTools.className = "tree-feature-tools";
  featureTools.innerHTML = '<button class="secondary-button" id="new-feature-btn" type="button">新建 Feature</button>';
  const featureList = document.createElement("div");
  featureList.className = "feature-list";
  const conversationTools = document.createElement("div");
  conversationTools.className = "tree-conversation-tools";
  conversationTools.innerHTML = '<button class="secondary-button" id="new-conversation-btn" type="button">新建对话</button>';
  const conversationList = document.createElement("div");
  conversationList.className = "conversation-list";
  children.append(featureTools, featureList, conversationTools, conversationList);
  renderFeatureList(featureList, { state, stageTitle, escapeHtml, onSelectFeature: handlers.selectFeature, onArchiveFeature: handlers.archiveFeature });
  renderConversationList(conversationList, { state, stageTitle, escapeHtml, onSelectConversation: handlers.selectConversation });
  children.querySelector("#new-feature-btn").addEventListener("click", handlers.createFeature);
  children.querySelector("#new-conversation-btn").addEventListener("click", handlers.createConversation);
  return children;
}
