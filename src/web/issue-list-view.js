export function renderIssueList(element, input) {
  const { state, stageTitle, escapeHtml, onSelectIssue, onArchiveIssue, onCreateConversation, onSelectConversation, renderConversationList } = input;
  element.innerHTML = "";
  if (!state.currentWorkspace) {
    element.innerHTML = '<div class="empty-state">先选择一个工作区</div>';
    return;
  }
  if (state.issues.length === 0) {
    element.innerHTML = '<div class="empty-state">暂无 Issue</div>';
    return;
  }
  // In board view (no issue selected), show compact issue list without conversation branch
  const isBoardView = !state.currentIssue;
  const { activeIssues, archivedIssues } = buildIssueGroups(state.issues);
  renderIssueGroup(element, { title: null, issues: activeIssues, state, stageTitle, escapeHtml, onSelectIssue, onArchiveIssue, onCreateConversation, onSelectConversation, renderConversationList, isBoardView });
  if (archivedIssues.length > 0) {
    renderIssueGroup(element, { title: "已归档", issues: archivedIssues, state, stageTitle, escapeHtml, onSelectIssue, onArchiveIssue, onCreateConversation, onSelectConversation, renderConversationList, isBoardView });
  }
}

export function buildIssueGroups(issues) {
  return {
    activeIssues: issues.filter((issue) => !issue.closed_at),
    archivedIssues: issues.filter((issue) => issue.closed_at !== null),
  };
}

function renderIssueGroup(element, input) {
  const { title, issues, state, escapeHtml, onSelectIssue, onArchiveIssue, onCreateConversation, onSelectConversation, renderConversationList, isBoardView } = input;
  if (title) {
    const heading = document.createElement("div");
    heading.className = "issue-group-title";
    heading.textContent = `${title} (${issues.length})`;
    element.appendChild(heading);
  }
  issues.forEach((issue) => {
    const row = document.createElement("div");
    row.className = "issue-row" + (issue.closed_at !== null ? " archived" : "") + (state.currentIssue?.id === issue.id ? " active" : "");
    const isCurrentIssue = state.currentIssue?.id === issue.id;
    const badge = issue.boss_pending_count > 0 ? `<span class="pending-badge">@${issue.boss_pending_count}</span>` : "";
    const archiveButton = issue.closed_at !== null ? "" : '<button type="button" class="issue-archive-button">归档</button>';
    row.innerHTML = `
      <button type="button" class="issue-select-button">
        <span class="node-main issue-title-row"><span class="chevron">${isCurrentIssue ? "▾" : "▸"}</span><span class="node-title issue-title-text">${escapeHtml(issue.title)}</span></span>
      </button>
      <div class="issue-row-actions">${badge}${archiveButton}</div>
    `;
    row.querySelector(".issue-select-button").addEventListener("click", () => onSelectIssue(issue.id));
    row.querySelector(".issue-archive-button")?.addEventListener("click", () => onArchiveIssue(issue.id));
    if (isCurrentIssue && !isBoardView) {
      row.appendChild(renderCurrentIssueConversations({ state, escapeHtml, onCreateConversation, onSelectConversation, renderConversationList }));
    }
    element.appendChild(row);
  });
}

function renderCurrentIssueConversations(input) {
  const { state, escapeHtml, onCreateConversation, onSelectConversation, renderConversationList } = input;
  const wrapper = document.createElement("div");
  wrapper.className = "issue-conversation-branch";
  const tools = document.createElement("div");
  tools.className = "tree-conversation-tools";
  tools.innerHTML = '<button class="secondary-button" type="button">新建对话</button>';
  const list = document.createElement("div");
  list.className = "conversation-list";
  wrapper.append(tools, list);
  tools.querySelector("button").addEventListener("click", onCreateConversation);
  renderConversationList(list, { state, escapeHtml, onSelectConversation });
  return wrapper;
}
