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
    elements.detail.querySelector("[data-policy-form]")?.addEventListener("submit", (event) => savePolicy(event));
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

  async function savePolicy(event) {
    event.preventDefault();
    if (!state.selected) return;
    const form = event.currentTarget;
    const result = await api("PUT", `/knowledge/${state.selected.id}/usage-policy`, parsePolicyForm(form));
    state.selected = await api("GET", `/knowledge/${state.selected.id}`);
    render();
    showNotice(`反哺策略已保存：${result.prompt_mode} · prompt=${result.allow_prompt_injection ? "on" : "off"}`);
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
        <p>知识是独立于阶段产物的旁路治理链路；所有候选知识必须人工审批后才会反哺系统。</p>
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
  const policy = normalizedPolicy(item.usage_policy);
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
        <section><h4>反哺策略</h4>${renderPolicySummary(policy)}<p>使用次数：${item.use_count || 0}</p><p class="knowledge-rationale">使用次数统计实际 prompt 注入、手动引用、skill、MCP/tool、checker 等反哺记录；批准本身不会增加计数。当前自动接入运行时的是系统提示词注入，其余载体先作为策略配置入口。</p></section>
      </div>
      ${renderPolicyForm(policy)}
      <div class="button-row knowledge-actions">
        ${item.status === "candidate" ? '<button class="primary-button" data-approve>批准</button><button class="ghost-button" data-reject>拒绝</button>' : ""}
        ${item.status === "active" ? '<button class="ghost-button" data-deprecate>废弃</button>' : ""}
      </div>
    </div>
  `;
}

function normalizedPolicy(policy) {
  return {
    allow_prompt_injection: Boolean(policy?.allow_prompt_injection),
    prompt_mode: policy?.prompt_mode || "reference_only",
    skill_visibility: Array.isArray(policy?.skill_visibility) ? policy.skill_visibility : [],
    tool_visibility: Array.isArray(policy?.tool_visibility) ? policy.tool_visibility : [],
    checker_binding: policy?.checker_binding || "",
    stage_types: Array.isArray(policy?.stage_types) ? policy.stage_types : [],
    snail_names: Array.isArray(policy?.snail_names) ? policy.snail_names : [],
    priority: Number.isFinite(Number(policy?.priority)) ? Number(policy.priority) : 0,
    token_budget: policy?.token_budget ?? "",
  };
}

function renderPolicySummary(policy) {
  const carrierItems = [
    `系统提示词：${policy.allow_prompt_injection && policy.prompt_mode !== "none" ? `启用 · ${policy.prompt_mode}` : "关闭"}`,
    `Skill：${policy.skill_visibility.length ? policy.skill_visibility.join(", ") : "未配置（待运行时接入）"}`,
    `MCP/tool：${policy.tool_visibility.length ? policy.tool_visibility.join(", ") : "未配置（待运行时接入）"}`,
    `Checker：${policy.checker_binding || "未绑定（待运行时接入）"}`,
    `Stage 约束：${policy.stage_types.length ? policy.stage_types.join(", ") : "不限"}`,
    `Snail 约束：${policy.snail_names.length ? policy.snail_names.join(", ") : "不限"}`,
    `优先级：${policy.priority}`,
  ];
  return `<ul>${carrierItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderPolicyForm(policy) {
  return `
    <form class="knowledge-policy-form" data-policy-form>
      <h4>反哺策略配置</h4>
      <p class="knowledge-rationale">系统提示词已接入运行时；Skill、MCP/tool、Checker 当前先沉淀可见性与绑定策略，供后续运行时按同一策略接入并记录使用。</p>
      <div class="knowledge-policy-grid">
        <label><span class="small-label">系统提示词注入</span><select name="allow_prompt_injection"><option value="true"${policy.allow_prompt_injection ? " selected" : ""}>启用</option><option value="false"${!policy.allow_prompt_injection ? " selected" : ""}>关闭</option></select></label>
        <label><span class="small-label">Prompt 模式</span><select name="prompt_mode">${["none", "summary", "full", "reference_only"].map((mode) => `<option value="${mode}"${policy.prompt_mode === mode ? " selected" : ""}>${mode}</option>`).join("")}</select></label>
        <label><span class="small-label">Stage 约束（逗号或换行分隔）</span><textarea name="stage_types" rows="2">${escapeHtml(policy.stage_types.join("\n"))}</textarea></label>
        <label><span class="small-label">Snail 约束（逗号或换行分隔）</span><textarea name="snail_names" rows="2">${escapeHtml(policy.snail_names.join("\n"))}</textarea></label>
        <label><span class="small-label">Skill 可见性（逗号或换行分隔）</span><textarea name="skill_visibility" rows="2">${escapeHtml(policy.skill_visibility.join("\n"))}</textarea></label>
        <label><span class="small-label">MCP/tool 可见性（逗号或换行分隔）</span><textarea name="tool_visibility" rows="2">${escapeHtml(policy.tool_visibility.join("\n"))}</textarea></label>
        <label><span class="small-label">Checker 绑定</span><input name="checker_binding" value="${escapeHtml(policy.checker_binding)}" placeholder="例如 code-comment-check"></label>
        <label><span class="small-label">优先级</span><input name="priority" type="number" value="${escapeHtml(String(policy.priority))}"></label>
        <label><span class="small-label">Token 预算（留空为不限）</span><input name="token_budget" type="number" value="${escapeHtml(String(policy.token_budget))}"></label>
      </div>
      <div class="button-row knowledge-actions"><button class="secondary-button" type="submit">保存反哺策略</button></div>
    </form>
  `;
}

function parsePolicyForm(form) {
  const field = (name) => form.elements[name]?.value ?? "";
  return {
    allow_prompt_injection: field("allow_prompt_injection") === "true",
    prompt_mode: String(field("prompt_mode") || "reference_only"),
    stage_types: splitList(field("stage_types")),
    snail_names: splitList(field("snail_names")),
    skill_visibility: splitList(field("skill_visibility")),
    tool_visibility: splitList(field("tool_visibility")),
    checker_binding: nullableString(field("checker_binding")),
    priority: numberValue(field("priority"), 0),
    token_budget: nullableNumber(field("token_budget")),
  };
}

function splitList(value) {
  return String(value || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function nullableString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
