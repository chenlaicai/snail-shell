import { escapeHtml } from "./message-view.js";

export function createEvolutionCenter(input) {
  const state = { items: [], selected: null, mode: "list", creating: false };
  const { api, elements, getCurrentProject, getWorkspaces, showNotice, onStateChange } = input;

  async function load(mode = state.mode, { skipRender = false } = {}) {
    state.mode = mode;
    try {
      state.items = await api("GET", "/evolution/items?limit=100");
    } catch (err) {
      state.items = [];
      showNotice(`加载演进工作区失败：${err.message}`, true);
    }
    if (!skipRender) render();
  }

  async function loadProjectEvolution(workspaceId) {
    state.mode = "workspace";
    try {
      state.items = await api("GET", `/workspaces/${workspaceId}/evolution/items?limit=100`);
    } catch (err) {
      state.items = [];
      showNotice(`加载项目演进工作区失败：${err.message}`, true);
    }
    render();
  }

  function render() {
    elements.summary.innerHTML = renderSummary(state, getCurrentProject());
    elements.list.innerHTML = renderList(state.items, state.selected);
    onStateChange?.(state);
    bindListEvents();
    renderDetail();
  }

  function bindListEvents() {
    Array.from(elements.list.querySelectorAll("[data-evolution-id]")).forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          state.selected = await api("GET", `/evolution/items/${button.getAttribute("data-evolution-id")}`);
        } catch (err) {
          showNotice(`加载演进工作区失败：${err.message}`, true);
          return;
        }
        render();
      });
    });
  }

  function renderDetail() {
    if (state.creating) {
      elements.detail.innerHTML = renderCreateForm(getWorkspaces?.() || [], getCurrentProject());
      bindCreateEvents();
      return;
    }
    elements.detail.innerHTML = state.selected
      ? renderItemDetail(state.selected)
      : '<div class="empty-state">选择一条演进工作区查看详情</div>';
  }

  function startCreate() {
    state.creating = true;
    state.selected = null;
    renderDetail();
  }

  function cancelCreate() {
    state.creating = false;
    renderDetail();
  }

  async function submitCreate() {
    const form = elements.detail.querySelector(".evolution-create-form");
    if (!form) return;
    const workspaceField = form.querySelector("[data-field='workspace_id']");
    const titleField = form.querySelector("[data-field='title']");
    const contentField = form.querySelector("[data-field='content']");
    if (!workspaceField || !titleField || !contentField) return;
    const workspaceId = workspaceField.value;
    const title = titleField.value.trim();
    const content = contentField.value.trim();
    if (!workspaceId) { showNotice("请选择所属项目", true); return; }
    if (!title) { showNotice("请输入标题", true); return; }
    if (!content) { showNotice("请输入内容", true); return; }
    if (title.length > 200) { showNotice("标题不能超过 200 字符", true); return; }
    if (content.length > 10000) { showNotice("内容不能超过 10000 字符", true); return; }
    try {
      const result = await api("POST", "/evolution/items", { workspace_id: workspaceId, title, content });
      state.creating = false;
      /** 刷新列表后选中新项，跳过 load() 内部的 render()，最后统一渲染一次 */
      await load(state.mode, { skipRender: true });
      state.selected = result;
      render();
      showNotice("演进工作区已创建");
    } catch (err) {
      showNotice(`创建失败：${err.message}`, true);
    }
  }

  function bindCreateEvents() {
    const form = elements.detail.querySelector(".evolution-create-form");
    if (!form) return;
    form.querySelector("[data-action='submit']")?.addEventListener("click", submitCreate);
    form.querySelector("[data-action='cancel']")?.addEventListener("click", cancelCreate);
  }

  return { load, loadProjectEvolution, render, startCreate, state };
}

function renderItemDetail(item) {
  const tags = (item.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join(" ");
  const conversationLink = item.conversation
    ? `<div class="evolution-detail-field"><span class="label">治理对话</span><span class="value">已关联 Conversation</span></div>`
    : "";

  return `
    <div class="evolution-detail">
      <div class="evolution-detail-header">
        <h2>${escapeHtml(item.title)}</h2>
        <div class="evolution-detail-tags">${tags}</div>
      </div>
      <div class="evolution-detail-meta">
        <div class="evolution-detail-field">
          <span class="label">项目</span>
          <span class="value">${escapeHtml(item.workspace_id)}</span>
        </div>
        <div class="evolution-detail-field">
          <span class="label">创建时间</span>
          <span class="value">${escapeHtml(formatTime(item.created_at))}</span>
        </div>
        <div class="evolution-detail-field">
          <span class="label">更新时间</span>
          <span class="value">${escapeHtml(formatTime(item.updated_at))}</span>
        </div>
        ${conversationLink}
      </div>
      <div class="evolution-detail-content">
        <pre>${escapeHtml(item.content)}</pre>
      </div>
    </div>
  `;
}

function renderSummary(state, workspace) {
  const modeTitle = state.mode === "workspace" && workspace ? `${escapeHtml(workspace.name)} · 演进工作区` : "演进中心";
  return `
    <div class="evolution-directory-summary">
      <div>
        <div class="panel-title">Evolution Center</div>
        <h3>${modeTitle}</h3>
        <p>选择一条演进工作区查看详情。</p>
      </div>
      <div class="evolution-stats">
        <div><strong>${state.items.length}</strong><span>演进工作区</span></div>
      </div>
    </div>
  `;
}

function renderCreateForm(workspaces, currentWorkspace) {
  if (!workspaces.length) {
    return `
      <div class="evolution-create-form">
        <h2>新增演进工作区</h2>
        <div class="empty-state">暂无可用项目，请先创建项目</div>
      </div>
    `;
  }

  const workspaceOptions = workspaces.map((p) =>
    `<option value="${escapeHtml(p.id)}"${currentWorkspace?.id === p.id ? " selected" : ""}>${escapeHtml(p.name)}</option>`
  ).join("");

  return `
    <div class="evolution-create-form">
      <h2>新增演进工作区</h2>
      <div class="evolution-form-field">
        <label>所属项目</label>
        <select data-field="workspace_id">${workspaceOptions}</select>
      </div>
      <div class="evolution-form-field">
        <label>标题</label>
        <input type="text" data-field="title" placeholder="演进工作区标题" />
      </div>
      <div class="evolution-form-field">
        <label>内容</label>
        <textarea data-field="content" rows="8" placeholder="描述问题、想法、待办事项等"></textarea>
      </div>
      <div class="evolution-form-actions">
        <button class="primary-button" data-action="submit">创建</button>
        <button class="ghost-button" data-action="cancel">取消</button>
      </div>
    </div>
  `;
}

function renderList(items, selected) {
  if (!items.length) return '<div class="empty-state">暂无演进工作区</div>';
  return items.map((item) => {
    const tags = (item.tags || []).join(", ");
    return `
      <button class="evolution-directory-row${selected?.id === item.id ? " active" : ""}" data-evolution-id="${escapeHtml(item.id)}">
        <span class="evolution-row-title">${escapeHtml(item.title)}</span>
        <span class="evolution-row-meta">${escapeHtml(item.workspace_id)}${tags ? " · " + escapeHtml(tags) : ""}</span>
        <span class="evolution-row-snippet">${escapeHtml(truncate(item.content, 80))}</span>
      </button>
    `;
  }).join("");
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function formatTime(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoString;
  }
}
