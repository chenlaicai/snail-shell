import { escapeHtml } from "./message-view.js";

export function createKnowledgeCenter(input) {
  const state = { items: [], candidates: [], selected: null, mode: "library" };
  const { api, elements, getCurrentProject, showNotice } = input;

  async function load(mode = state.mode) {
    state.mode = mode;
    state.items = await api("GET", "/knowledge?limit=100");
    state.candidates = await api("GET", "/knowledge/candidates?limit=100");
    render();
  }

  async function loadProjectKnowledge(projectId) {
    state.mode = "project";
    state.items = await api("GET", `/projects/${projectId}/knowledge?limit=100`);
    state.candidates = await api("GET", `/projects/${projectId}/knowledge?status=candidate&limit=100`);
    render();
  }

  function render() {
    elements.summary.innerHTML = renderSummary(state, getCurrentProject());
    elements.list.innerHTML = renderList(currentItems(), state.selected);
    bindListEvents();
    renderDetail();
  }

  function currentItems() {
    if (state.mode === "candidates") return state.candidates;
    return state.items;
  }

  function bindListEvents() {
    Array.from(elements.list.querySelectorAll("[data-knowledge-id]")).forEach((button) => {
      button.addEventListener("click", async () => {
        state.selected = await api("GET", `/knowledge/${button.getAttribute("data-knowledge-id")}`);
        render();
      });
    });
  }

  function renderDetail() {
    if (!state.selected) {
      elements.detail.innerHTML = '<div class="empty-state">选择一条知识查看详情和审批操作</div>';
      return;
    }
    elements.detail.innerHTML = renderKnowledgeDetail(state.selected);
    bindDetailEvents();
  }

  function bindDetailEvents() {
    elements.detail.querySelector("[data-approve]")?.addEventListener("click", () => approveSelected());
    elements.detail.querySelector("[data-reject]")?.addEventListener("click", () => transitionSelected("reject"));
    elements.detail.querySelector("[data-deprecate]")?.addEventListener("click", () => transitionSelected("deprecate"));
  }

  async function approveSelected() {
    if (!state.selected) return;
    const result = await api("POST", `/knowledge/${state.selected.id}/approve`, { reviewer: "Boss Snail" });
    state.selected = result;
    await load(state.mode);
    showNotice("知识已批准");
  }

  async function transitionSelected(action) {
    if (!state.selected) return;
    const result = await api("POST", `/knowledge/${state.selected.id}/${action}`, { reviewer: "Boss Snail" });
    state.selected = result;
    await load(state.mode);
    showNotice("知识状态已更新");
  }

  return { load, loadProjectKnowledge, render, state };
}

function renderSummary(state, project) {
  const active = state.items.filter((item) => item.status === "active").length;
  return `
    <div class="knowledge-hero">
      <div>
        <div class="panel-title">Knowledge Center</div>
        <h3>${state.mode === "project" && project ? `${escapeHtml(project.name)} · 项目知识` : "知识中心"}</h3>
        <p>知识是独立于阶段产物的旁路治理链路；所有候选知识必须人工审批后，才能通过 prompt、skill、tool、checker 或长期入口反哺系统。</p>
      </div>
      <div class="knowledge-stats">
        <div><strong>${active}</strong><span>已生效</span></div>
        <div><strong>${state.candidates.length}</strong><span>待审批</span></div>
      </div>
    </div>
  `;
}

function renderList(items, selected) {
  if (!items.length) return '<div class="empty-state">暂无知识</div>';
  return items.map((item) => `
    <button class="knowledge-row${selected?.id === item.id ? " active" : ""}" data-knowledge-id="${escapeHtml(item.id)}">
      <div class="knowledge-row-title">${escapeHtml(item.title)}</div>
      <div class="knowledge-row-meta">${escapeHtml(item.kind)} · ${escapeHtml(item.scope_type)}:${escapeHtml(item.scope_ref || "*")} · ${escapeHtml(item.status)}</div>
      <div class="knowledge-row-snippet">${escapeHtml(item.snippet || item.content || "")}</div>
    </button>
  `).join("");
}

function renderKnowledgeDetail(item) {
  const sources = item.sources?.length ? item.sources.map((source) => `<li>${escapeHtml(source.source_type)}:${escapeHtml(source.source_id)}${source.quote ? ` · ${escapeHtml(source.quote)}` : ""}</li>`).join("") : "<li>无来源</li>";
  const policyItems = renderKnowledgePolicyItems(item.usage_policy);
  return `
    <div class="knowledge-detail-card">
      <div class="knowledge-detail-header">
        <div>
          <div class="panel-title">${escapeHtml(item.kind)} · ${escapeHtml(item.status)} · ${escapeHtml(item.governance_level)}</div>
          <h3>${escapeHtml(item.title)}</h3>
        </div>
        <span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.scope_type)}:${escapeHtml(item.scope_ref || "*")}</span>
      </div>
      <p>${escapeHtml(item.content)}</p>
      ${item.rationale ? `<div class="knowledge-rationale">${escapeHtml(item.rationale)}</div>` : ""}
      <div class="knowledge-detail-grid">
        <section><h4>来源</h4><ul>${sources}</ul></section>
        <section><h4>反哺策略</h4><ul>${policyItems}</ul><p>使用次数：${item.use_count || 0}</p></section>
      </div>
      <div class="button-row knowledge-actions">
        ${item.status === "candidate" ? '<button class="primary-button" data-approve>批准</button><button class="ghost-button" data-reject>拒绝</button>' : ""}
        ${item.status === "active" ? '<button class="ghost-button" data-deprecate>废弃</button>' : ""}
      </div>
    </div>
  `;
}

function renderKnowledgePolicyItems(policy) {
  if (!policy) return "<li>未配置</li>";
  const prompt = `${policy.allow_prompt_injection ? "on" : "off"} · ${policy.prompt_mode || "reference_only"}`;
  return [
    `prompt: ${prompt}`,
    `skill: ${formatPolicyList(policy.skill_visibility)}`,
    `tool: ${formatPolicyList(policy.tool_visibility)}`,
    `checker: ${policy.checker_binding || "未绑定"}`,
    `stage: ${formatPolicyList(policy.stage_types)}`,
    `snail: ${formatPolicyList(policy.snail_names)}`,
    `priority: ${policy.priority ?? 0}`,
  ].map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function formatPolicyList(value) {
  return Array.isArray(value) && value.length ? value.join(", ") : "*";
}
