import { escapeHtml } from "./message-view.js";

export function createKnowledgeCenter(input) {
  const state = { items: [], candidates: [], selected: null, mode: "library" };
  const { api, elements, getCurrentProject, showNotice, onStateChange } = input;

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
    onStateChange?.(state);
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
  const modeTitle = state.mode === "candidates" ? "待审批" : state.mode === "project" && project ? `${escapeHtml(project.name)} · 项目知识` : "知识库";
  return `
    <div class="knowledge-directory-summary">
      <div>
        <div class="panel-title">Knowledge Center</div>
        <h3>${modeTitle}</h3>
        <p>选择一条知识后，在中间详情区查看内容和操作。</p>
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
    <button class="knowledge-directory-row${selected?.id === item.id ? " active" : ""}" data-knowledge-id="${escapeHtml(item.id)}">
      <span class="knowledge-row-title">${escapeHtml(item.title)}</span>
      <span class="knowledge-row-meta">${escapeHtml(item.kind)} · ${escapeHtml(item.scope_type)}:${escapeHtml(item.scope_ref || "*")} · ${escapeHtml(item.status)}</span>
      <span class="knowledge-row-snippet">${escapeHtml(item.snippet || item.content || "")}</span>
    </button>
  `).join("");
}

function renderKnowledgeDetail(item) {
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
      ${renderKnowledgeFieldGuide(item)}
      <div class="knowledge-detail-grid">
        <section><h4>来源与追溯</h4>${renderSources(item.sources)}</section>
        <section><h4>真实反哺状态</h4>${renderPolicySummary(policy, item.use_count || 0)}</section>
      </div>
      ${renderPolicyForm(policy)}
      <div class="button-row knowledge-actions">
        ${item.status === "candidate" ? '<button class="primary-button" data-approve>批准</button><button class="ghost-button" data-reject>拒绝</button>' : ""}
        ${item.status === "active" ? '<button class="ghost-button" data-deprecate>废弃</button>' : ""}
      </div>
    </div>
  `;
}

function renderKnowledgeFieldGuide(item) {
  const fields = [
    { label: "标题", value: item.title, help: "用一句话说明这条知识是什么，方便以后在知识库里快速识别。" },
    { label: "知识内容", value: item.content, help: "真正要被长期记住和复用的规则、偏好、事实、流程或结论。" },
    { label: "类型", value: describeKind(item.kind), help: "说明这条知识的性质，系统会用它辅助判断默认反哺方式。" },
    { label: "作用域", value: `${item.scope_type}:${item.scope_ref || "*"}`, help: "说明这条知识适用于哪里；* 表示当前作用域下不再指定具体对象。" },
    { label: "治理状态", value: describeStatus(item.status), help: "说明它处在候选、已批准、废弃等哪个治理阶段；只有 active 才具备自动反哺资格。" },
    { label: "治理等级", value: describeGovernanceLevel(item.governance_level), help: "表示这条知识被确认的强度；L2 或规则/偏好类知识默认更适合进入系统提示词。" },
    { label: "原因 / 设计意图", value: item.rationale || "未填写", help: "解释为什么要保留这条知识，帮助后续维护者判断是否还能沿用。" },
  ];
  return `<div class="knowledge-field-grid">${fields.map(renderKnowledgeField).join("")}</div>`;
}

function renderKnowledgeField(field) {
  return `
    <section class="knowledge-field-card">
      <div class="knowledge-field-label">${escapeHtml(field.label)}</div>
      <div class="knowledge-field-value">${escapeHtml(field.value)}</div>
      <p>${escapeHtml(field.help)}</p>
    </section>
  `;
}

function renderSources(sources) {
  if (!sources?.length) return '<p class="knowledge-help-text">暂无来源。建议候选知识保留消息、产物、PR 或检视评论来源，方便以后追溯原文。</p>';
  return `<ul class="knowledge-source-list">${sources.map((source) => `<li><strong>${escapeHtml(source.source_type)}:${escapeHtml(source.source_id)}</strong>${source.quote ? `<span>${escapeHtml(source.quote)}</span>` : ""}</li>`).join("")}</ul>`;
}

function normalizedPolicy(policy) {
  return {
    allow_prompt_injection: Boolean(policy?.allow_prompt_injection),
    prompt_mode: policy?.prompt_mode || "reference_only",
    stage_types: Array.isArray(policy?.stage_types) ? policy.stage_types : [],
    snail_names: Array.isArray(policy?.snail_names) ? policy.snail_names : [],
    priority: Number.isFinite(Number(policy?.priority)) ? Number(policy.priority) : 0,
  };
}

function renderPolicySummary(policy, useCount) {
  const fields = [
    { label: "系统提示词注入", value: policy.allow_prompt_injection && policy.prompt_mode !== "none" ? "启用" : "关闭", help: "开启后，匹配当前项目、阶段和 Snail 时，这条知识才可能进入 agent 的系统提示词。" },
    { label: "Prompt 模式", value: describePromptMode(policy.prompt_mode), help: "决定注入时给 agent 看多少内容，以及以什么方式提醒。" },
    { label: "Stage 约束", value: policy.stage_types.length ? policy.stage_types.join(", ") : "不限", help: "留空表示所有阶段都可用；填写后只在这些阶段注入。" },
    { label: "Snail 约束", value: policy.snail_names.length ? policy.snail_names.join(", ") : "不限", help: "留空表示所有角色都可用；填写后只给这些 Snail 注入。" },
    { label: "优先级", value: String(policy.priority), help: "多条知识同时命中时，数字越大越靠前。" },
    { label: "使用次数", value: String(useCount), help: "统计实际进入运行时上下文或被人工引用的次数；批准本身不会增加计数。" },
  ];
  return `<div class="knowledge-policy-summary">${fields.map(renderKnowledgeField).join("")}</div><p class="knowledge-rationale">当前已封装的自动生效方式是系统提示词注入。Skill、MCP/tool、Checker 需要先落成静态产物或运行时注册后才算生效，不能只保存字段就宣称生效。</p>`;
}

function renderPolicyForm(policy) {
  return `
    <form class="knowledge-policy-form" data-policy-form>
      <h4>系统提示词反哺配置</h4>
      <p class="knowledge-rationale">这里只配置当前真实接入运行时的 prompt 注入。下面每一项都只影响“是否把这条知识放进 agent 的系统提示词”。Skill、MCP/tool、Checker 需要通过静态产物或运行时注册单独落地，不能只保存字段就算生效。</p>
      ${renderPromptModeGuide()}
      <div class="knowledge-policy-grid">
        <label class="knowledge-policy-control"><span class="small-label">系统提示词注入</span><select name="allow_prompt_injection"><option value="true"${policy.allow_prompt_injection ? " selected" : ""}>启用：允许匹配时进入系统提示词</option><option value="false"${!policy.allow_prompt_injection ? " selected" : ""}>关闭：只保存在知识库，不自动提醒 agent</option></select><span class="knowledge-input-help">如果不确定这条知识是否应该影响 agent 行为，先选择关闭。</span></label>
        <label class="knowledge-policy-control"><span class="small-label">Prompt 模式</span><select name="prompt_mode">${PROMPT_MODE_OPTIONS.map((option) => `<option value="${option.value}"${policy.prompt_mode === option.value ? " selected" : ""}>${option.label}</option>`).join("")}</select><span class="knowledge-input-help">不知道选哪个时，规则和偏好通常选“参考提醒”，长决策通常选“摘要”。</span></label>
        <label class="knowledge-policy-control"><span class="small-label">Stage 约束</span><textarea name="stage_types" rows="3" placeholder="留空 = 所有阶段都可用\ndevelopment\nreview">${escapeHtml(policy.stage_types.join("\n"))}</textarea><span class="knowledge-input-help">填阶段类型，一行一个或用逗号分隔；只想在研发阶段提醒就填 development。</span></label>
        <label class="knowledge-policy-control"><span class="small-label">Snail 约束</span><textarea name="snail_names" rows="3" placeholder="留空 = 所有 Snail 都可用\nImplementation Snail\nAcceptance Snail">${escapeHtml(policy.snail_names.join("\n"))}</textarea><span class="knowledge-input-help">填角色名，一行一个或用逗号分隔；只想提醒研发者就填 Implementation Snail。</span></label>
        <label class="knowledge-policy-control"><span class="small-label">优先级</span><input name="priority" type="number" value="${escapeHtml(String(policy.priority))}"><span class="knowledge-input-help">数字越大越先进入提示词。项目/Feature 规则通常用 20，一般参考知识可用 10。</span></label>
      </div>
      <div class="button-row knowledge-actions"><button class="secondary-button" type="submit">保存反哺策略</button></div>
    </form>
  `;
}

const PROMPT_MODE_OPTIONS = [
  { value: "none", label: "不注入：保存知识，但不自动放进系统提示词", help: "适合只做资料归档、暂不希望影响 agent 行为的知识。" },
  { value: "summary", label: "摘要：只提醒结论，适合长决策", help: "适合决策记录、复盘结论或内容较长的知识，减少 prompt 噪音。" },
  { value: "full", label: "完整内容：逐字给 agent 看", help: "适合短小但必须完整遵守的规则；长内容慎用，避免挤占上下文。" },
  { value: "reference_only", label: "参考提醒：告诉 agent 需要参考这条知识", help: "适合偏好、流程和一般规则，也是大多数知识的安全默认选择。" },
];

function renderPromptModeGuide() {
  return `<div class="knowledge-mode-guide"><h5>Prompt 模式怎么选</h5>${PROMPT_MODE_OPTIONS.map((option) => `<div><strong>${escapeHtml(option.label)}</strong><span>${escapeHtml(option.help)}</span></div>`).join("")}</div>`;
}

function describePromptMode(mode) {
  return PROMPT_MODE_OPTIONS.find((option) => option.value === mode)?.label || mode;
}

function describeKind(kind) {
  const labels = { decision: "决策：已经做出的设计或流程结论", rule: "规则：必须遵守的约束", preference: "偏好：用户或项目的长期倾向", incident: "事故：失败案例或问题复盘", anti_pattern: "反模式：明确不应采用的做法", glossary: "术语：概念定义", open_question: "开放问题：尚未关闭的治理问题", procedure: "流程：可复用操作步骤", fact: "事实：稳定事实", pattern: "模式：可复用实践" };
  return labels[kind] || kind;
}

function describeStatus(status) {
  const labels = { candidate: "候选：等待审批", active: "已生效资格：已批准，可被反哺策略使用", rejected: "已拒绝", superseded: "已被新知识替代", deprecated: "已废弃", archived: "已归档" };
  return labels[status] || status;
}

function describeGovernanceLevel(level) {
  const labels = { L0: "L0：候选或未充分确认", L1: "L1：已完成基本审批", L2: "L2：高可信，默认更适合进入提示词", L3: "L3：强治理级别" };
  return labels[level] || level;
}

function parsePolicyForm(form) {
  const field = (name) => form.elements[name]?.value ?? "";
  return {
    allow_prompt_injection: field("allow_prompt_injection") === "true",
    prompt_mode: String(field("prompt_mode") || "reference_only"),
    stage_types: splitList(field("stage_types")),
    snail_names: splitList(field("snail_names")),
    priority: numberValue(field("priority"), 0),
  };
}

function splitList(value) {
  return String(value || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
