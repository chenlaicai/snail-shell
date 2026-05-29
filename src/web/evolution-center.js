import { escapeHtml } from "./message-view.js";

export function createEvolutionCenter(input) {
  const state = { items: [], selected: null, mode: "list" };
  const { api, elements, getCurrentProject, showNotice, onStateChange } = input;

  async function load(mode = state.mode) {
    state.mode = mode;
    try {
      state.items = await api("GET", "/evolution/items?limit=100");
    } catch {
      state.items = [];
    }
    render();
  }

  async function loadProjectEvolution(projectId) {
    state.mode = "project";
    try {
      state.items = await api("GET", `/projects/${projectId}/evolution/items?limit=100`);
    } catch {
      state.items = [];
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
          showNotice(`加载演进项失败：${err.message}`, true);
          return;
        }
        render();
      });
    });
  }

  function renderDetail() {
    elements.detail.innerHTML = state.selected
      ? renderItemDetail(state.selected)
      : '<div class="empty-state">选择一条演进项查看详情</div>';
  }

  return { load, loadProjectEvolution, render, state };
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
          <span class="value">${escapeHtml(item.project_id)}</span>
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

function renderSummary(state, project) {
  const modeTitle = state.mode === "project" && project ? `${escapeHtml(project.name)} · 演进项` : "演进中心";
  return `
    <div class="evolution-directory-summary">
      <div>
        <div class="panel-title">Evolution Center</div>
        <h3>${modeTitle}</h3>
        <p>选择一条演进项查看详情。</p>
      </div>
      <div class="evolution-stats">
        <div><strong>${state.items.length}</strong><span>演进项</span></div>
      </div>
    </div>
  `;
}

function renderList(items, selected) {
  if (!items.length) return '<div class="empty-state">暂无演进项</div>';
  return items.map((item) => {
    const tags = (item.tags || []).join(", ");
    return `
      <button class="evolution-directory-row${selected?.id === item.id ? " active" : ""}" data-evolution-id="${escapeHtml(item.id)}">
        <span class="evolution-row-title">${escapeHtml(item.title)}</span>
        <span class="evolution-row-meta">${escapeHtml(item.project_id)}${tags ? " · " + escapeHtml(tags) : ""}</span>
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
