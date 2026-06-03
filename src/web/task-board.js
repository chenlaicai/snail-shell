/**
 * task-board.js — Workspace 任务看板视图
 *
 * 三列看板：待处理 / AI工作中 / 已完成
 * 点击卡片进入 Issue 对话视图。
 */

const STATUS_GROUPS = [
  { key: "pending", label: "待处理", icon: "pending" },
  { key: "in_progress", label: "AI 工作中", icon: "active" },
  { key: "completed", label: "已完成", icon: "done" },
];

const GROUP_ICONS = {
  pending: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning-soft)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  active: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-blue)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>',
  done: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-cyan)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
};

function classifyIssue(issue) {
  if (issue.closed_at) return "completed";
  if (issue.current_stage?.status === "in_progress") return "in_progress";
  return "pending";
}

function formatWaitTime(dateStr) {
  if (!dateStr) return "";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  if (diffMs < 0) return "";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

function stageTagClass(issue) {
  const type = issue.current_stage?.type;
  if (type === "design") return "design";
  if (type === "development") return "development";
  if (type === "review") return "review";
  if (issue.closed_at) return "done";
  return "";
}

function stageLabel(issue) {
  const type = issue.current_stage?.type;
  if (type === "design") return "design";
  if (type === "development") return "development";
  if (type === "review") return "review";
  if (issue.closed_at) return "done";
  return "pending";
}

/** Cached DOM element for HTML escaping. */
let _escDiv = null;
function escapeHtml(str) {
  if (!_escDiv) _escDiv = document.createElement("div");
  _escDiv.textContent = str || "";
  return _escDiv.innerHTML;
}

/** Create the top row (title + ID) for a task card. */
function createTopRow(issue) {
  const row = document.createElement("div");
  row.className = "task-top-row";
  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = issue.title;
  const id = document.createElement("span");
  id.className = "task-id";
  id.textContent = `#${issue.id.slice(-6)}`;
  row.append(title, id);
  return row;
}

/** Create the meta row (stage tag + wait time / close date) for a task card. */
function createMetaRow(issue) {
  const meta = document.createElement("div");
  meta.className = "task-meta";
  const tag = document.createElement("span");
  tag.className = "task-stage-tag " + stageTagClass(issue);
  tag.textContent = stageLabel(issue);
  meta.append(tag);
  if (!issue.closed_at) {
    const waitStr = formatWaitTime(issue.current_stage?.created_at || issue.created_at);
    if (waitStr) {
      const wait = document.createElement("span");
      wait.className = "task-meta-item";
      wait.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg><span>等待 ${escapeHtml(waitStr)}</span>`;
      meta.append(wait);
    }
    if (issue.current_stage?.active_roles?.length > 0) {
      const role = document.createElement("span");
      role.className = "task-meta-item";
      role.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg><span>${escapeHtml(issue.current_stage.active_roles[0])}</span>`;
      meta.append(role);
    }
  } else {
    const d = new Date(issue.closed_at);
    const time = document.createElement("span");
    time.className = "task-time";
    time.textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    meta.append(time);
  }
  return meta;
}

/** Render a single task card. */
function renderTaskCard(issue, onSelectIssue) {
  const card = document.createElement("div");
  card.className = "task-card" + (issue.closed_at ? " completed" : "");
  const body = document.createElement("div");
  body.className = "task-body";
  body.append(createTopRow(issue));
  if (!issue.closed_at && issue.summary) {
    const summary = document.createElement("div");
    summary.className = "task-summary";
    summary.textContent = issue.summary;
    body.append(summary);
  }
  body.append(createMetaRow(issue));
  if (issue.closed_at) {
    const check = document.createElement("div");
    check.className = "task-completed-check";
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    card.append(check, body);
  } else {
    const priority = document.createElement("div");
    priority.className = "task-priority " + (stageTagClass(issue) || "low");
    card.append(priority, body);
  }
  card.addEventListener("click", () => onSelectIssue(issue.id));
  return card;
}

/** Render the board header (workspace name + new issue button). */
function renderBoardHeader(workspace, activeCount, onCreateIssue) {
  const header = document.createElement("div");
  header.className = "board-header";
  const titleArea = document.createElement("div");
  titleArea.className = "board-title-area";
  const title = document.createElement("span");
  title.className = "board-title";
  title.textContent = workspace.name;
  const subtitle = document.createElement("span");
  subtitle.className = "board-subtitle";
  subtitle.textContent = `${activeCount} 个 Issue`;
  titleArea.append(title, subtitle);
  const actions = document.createElement("div");
  actions.className = "board-actions";
  const newBtn = document.createElement("button");
  newBtn.className = "board-btn board-btn-primary";
  newBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 新 Issue';
  newBtn.addEventListener("click", onCreateIssue);
  actions.append(newBtn);
  header.append(titleArea, actions);
  return header;
}

/** Render a single group column (header + cards). */
function renderGroupColumn(group, issues, onSelectIssue) {
  const groupEl = document.createElement("div");
  groupEl.className = "task-group";
  const groupHeader = document.createElement("div");
  groupHeader.className = "task-group-header";
  const icon = document.createElement("span");
  icon.className = "task-group-icon";
  icon.innerHTML = GROUP_ICONS[group.icon] || "";
  const groupTitle = document.createElement("span");
  groupTitle.className = "task-group-title";
  groupTitle.textContent = group.label;
  const count = document.createElement("span");
  count.className = "task-group-count";
  count.textContent = String(issues.length);
  const line = document.createElement("span");
  line.className = "task-group-line";
  groupHeader.append(icon, groupTitle, count, line);
  groupEl.append(groupHeader);
  for (const issue of issues) {
    groupEl.append(renderTaskCard(issue, onSelectIssue));
  }
  return groupEl;
}

/**
 * Render the task board into the given container.
 *
 * @param {HTMLElement} container - the #task-board element
 * @param {object} input
 * @param {object} input.state - shared application state
 * @param {function} input.onSelectIssue - called with issueId when a card is clicked
 * @param {function} input.onCreateIssue - called when "新 Issue" is clicked
 */
export function renderTaskBoard(container, { state, onSelectIssue, onCreateIssue }) {
  container.innerHTML = "";
  if (!state.currentWorkspace) {
    container.innerHTML = '<div class="task-board-empty">先选择一个工作区</div>';
    return;
  }
  const groups = { pending: [], in_progress: [], completed: [] };
  for (const issue of (state.issues || [])) {
    groups[classifyIssue(issue)].push(issue);
  }
  container.append(
    renderBoardHeader(state.currentWorkspace, groups.pending.length + groups.in_progress.length, onCreateIssue),
    ...STATUS_GROUPS.map((g) => renderGroupColumn(g, groups[g.key], onSelectIssue)),
  );
  // Wrap groups in a task-list container
  const taskList = document.createElement("div");
  taskList.className = "task-list";
  while (container.children.length > 1) {
    taskList.append(container.lastChild);
  }
  container.append(taskList);
}
