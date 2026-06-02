export function renderWorkspaceTreeView(element, input) {
  const { state, stageTitle, escapeHtml, renderIssueList, handlers } = input;
  element.innerHTML = "";
  if (state.workspaces.length === 0) {
    element.innerHTML = '<div class="empty-state">暂无工作区</div>';
    return;
  }
  /** Evolution Center 是独立一级模块，有自己的导航入口，不应出现在工作区管理侧边栏 */
  state.workspaces.filter((workspace) => workspace.id !== "evolution-center").forEach((workspace) => {
    const isCurrentWorkspace = state.currentWorkspace?.id === workspace.id;
    const workspaceNode = document.createElement("div");
    workspaceNode.className = "tree-workspace-node" + (isCurrentWorkspace ? " active" : "");
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tree-workspace";
    const badge = workspace.boss_pending_count > 0 ? `<span class="pending-badge">@${workspace.boss_pending_count}</span>` : "";
    item.innerHTML = `
      <span>
        <span class="node-header"><span class="node-main"><span class="chevron">${isCurrentWorkspace ? "▾" : "▸"}</span><span class="node-title">${escapeHtml(workspace.name)}</span></span>${badge}</span>
        <span class="node-meta">${escapeHtml(workspace.module)}</span>
      </span>
    `;
    item.addEventListener("click", () => handlers.selectWorkspace(workspace.id));
    workspaceNode.appendChild(item);
    if (isCurrentWorkspace) {
      workspaceNode.appendChild(renderCurrentWorkspaceChildren({ state, stageTitle, escapeHtml, renderIssueList, handlers }));
    }
    element.appendChild(workspaceNode);
  });
}

export function renderConversationList(conversationList, input) {
  const { state, escapeHtml, onSelectConversation } = input;
  conversationList.innerHTML = "";
  if (!state.currentIssue) {
    conversationList.innerHTML = '<div class="empty-state">先选择一个 Issue</div>';
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
  const { state, stageTitle, escapeHtml, renderIssueList, handlers } = input;
  const children = document.createElement("div");
  children.className = "tree-children";
  const issueTools = document.createElement("div");
  issueTools.className = "tree-issue-tools";
  issueTools.innerHTML = `
    <button class="secondary-button" id="new-issue-btn" type="button">新建 Issue</button>
    <button class="ghost-button" id="reload-snail-btn" type="button" title="从 .snail 目录重新加载配置">刷新配置</button>
  `;
  const issueList = document.createElement("div");
  issueList.className = "issue-list";
  children.append(issueTools, issueList);
  renderIssueList(issueList, {
    state,
    stageTitle,
    escapeHtml,
    onSelectIssue: handlers.selectIssue,
    onArchiveIssue: handlers.archiveIssue,
    onCreateConversation: handlers.createConversation,
    onSelectConversation: handlers.selectConversation,
    renderConversationList,
  });
  children.querySelector("#new-issue-btn").addEventListener("click", handlers.createIssue);
  children.querySelector("#reload-snail-btn").addEventListener("click", handlers.reloadSnailConfig);
  return children;
}
