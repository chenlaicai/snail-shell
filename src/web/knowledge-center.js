import { escapeHtml } from "./message-view.js";

export function createKnowledgeCenter(input) {
  const state = { items: [], candidates: [], selected: null, mode: "library", governanceMessages: [], governanceConversationId: null };
  const { api, elements, getCurrentProject, showNotice, onStateChange } = input;
  let realtimeConnection = null;

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
        await loadGovernanceConversation();
        render();
      });
    });
  }

  async function loadGovernanceConversation() {
    if (!state.selected?.governance?.conversation?.id) {
      state.governanceMessages = [];
      state.governanceConversationId = null;
      return;
    }
    state.governanceConversationId = state.selected.governance.conversation.id;
    try {
      state.governanceMessages = await api("GET", `/knowledge/${state.selected.id}/governance-conversation/messages`);
    } catch {
      state.governanceMessages = [];
    }
  }

  function renderDetail() {
    if (!state.selected) {
      elements.detail.innerHTML = '<div class="empty-state">选择一条知识查看来源、治理对话和裁决去向</div>';
      return;
    }
    elements.detail.innerHTML = renderKnowledgeDetail(state.selected);
    bindDetailEvents();
    renderGovernanceChat();
  }

  function bindDetailEvents() {
    elements.detail.querySelector("[data-approve]")?.addEventListener("click", () => approveSelected());
    elements.detail.querySelector("[data-reject]")?.addEventListener("click", () => transitionSelected("reject"));
    elements.detail.querySelector("[data-deprecate]")?.addEventListener("click", () => transitionSelected("deprecate"));
    elements.detail.querySelector("[data-governance-send]")?.addEventListener("click", () => sendGovernanceMessage());
    elements.detail.querySelector("[data-governance-input]")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendGovernanceMessage();
      }
    });
  }

  async function sendGovernanceMessage() {
    if (!state.selected) return;
    const input = elements.detail.querySelector("[data-governance-input]");
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;
    input.value = "";
    try {
      await api("POST", `/knowledge/${state.selected.id}/governance-conversation/messages`, {
        content,
        from_role: "Boss Role",
      });
      await loadGovernanceMessages();
    } catch (err) {
      showNotice(`发送失败：${err.message}`, true);
    }
  }

  async function loadGovernanceMessages() {
    if (!state.selected) return;
    try {
      state.governanceMessages = await api("GET", `/knowledge/${state.selected.id}/governance-conversation/messages`);
      renderGovernanceChat();
    } catch {
      // ignore
    }
  }

  function renderGovernanceChat() {
    const chatContainer = elements.detail.querySelector("[data-governance-chat]");
    if (!chatContainer) return;
    if (!state.governanceConversationId) {
      chatContainer.innerHTML = '<div class="empty-state">暂无治理对话</div>';
      return;
    }
    chatContainer.innerHTML = `
      <div class="governance-chat-messages" data-governance-messages></div>
      <div class="governance-chat-input">
        <textarea data-governance-input placeholder="输入消息与角色协作治理此知识..." rows="2"></textarea>
        <button class="primary-button" data-governance-send>发送</button>
      </div>
    `;
    renderGovernanceMessages(state);
  }

  async function approveSelected() {
    if (!state.selected) return;
    const result = await api("POST", `/knowledge/${state.selected.id}/approve`, { reviewer: "Boss Role" });
    state.selected = result;
    await load(state.mode);
    showNotice("知识本体已确认为 active");
  }

  async function transitionSelected(action) {
    if (!state.selected) return;
    const result = await api("POST", `/knowledge/${state.selected.id}/${action}`, { reviewer: "Boss Role" });
    state.selected = result;
    await load(state.mode);
    showNotice("知识状态已更新");
  }

  function disconnectRealtime() {
    if (realtimeConnection) {
      realtimeConnection.close();
      realtimeConnection = null;
    }
  }

  return { load, loadProjectKnowledge, render, state, disconnectRealtime };
}

function renderGovernanceMessages(state) {
  const messagesContainer = document.querySelector("[data-governance-messages]");
  if (!messagesContainer) return;
  if (!state?.governanceMessages?.length) {
    messagesContainer.innerHTML = '<div class="empty-state">暂无消息，开始对话以治理此知识</div>';
    return;
  }
  messagesContainer.innerHTML = state.governanceMessages.map((msg) => {
    const isUser = msg.role === "user";
    const content = extractMessageContent(msg);
    return `
      <div class="governance-message ${isUser ? "user" : "assistant"}">
        <div class="governance-message-header">
          <span class="governance-message-sender">${escapeHtml(msg.from_role || (isUser ? "Boss Role" : "Snail"))}</span>
          <span class="governance-message-time">${escapeHtml(formatTime(msg.created_at))}</span>
        </div>
        <div class="governance-message-content">${escapeHtml(content)}</div>
      </div>
    `;
  }).join("");
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function extractMessageContent(message) {
  if (!message.events?.length) return "";
  for (const event of message.events) {
    if (event.kind === "content" && event.payload?.content) {
      return event.payload.content;
    }
    if (event.kind === "content_block" && event.payload?.blocks?.length) {
      return event.payload.blocks.map((block) => block.text || "").join("\n");
    }
  }
  return "";
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function renderSummary(state, project) {
  const active = state.items.filter((item) => item.status === "active").length;
  const modeTitle = state.mode === "candidates" ? "待治理候选" : state.mode === "project" && project ? `${escapeHtml(project.name)} · 项目知识` : "知识库";
  return `
    <div class="knowledge-directory-summary">
      <div>
        <div class="panel-title">Knowledge Center</div>
        <h3>${modeTitle}</h3>
        <p>选择一条知识后，在中间详情区查看来源、治理进度和裁决去向。</p>
      </div>
      <div class="knowledge-stats">
        <div><strong>${active}</strong><span>已生效</span></div>
        <div><strong>${state.candidates.length}</strong><span>待治理</span></div>
      </div>
    </div>
  `;
}

function renderList(items, selected) {
  if (!items.length) return '<div class="empty-state">暂无知识</div>';
  return items.map((item) => `
    <button class="knowledge-directory-row${selected?.id === item.id ? " active" : ""}" data-knowledge-id="${escapeHtml(item.id)}">
      <span class="knowledge-row-title">${escapeHtml(item.title)}</span>
      <span class="knowledge-row-meta">${escapeHtml(item.kind)} · ${escapeHtml(item.scope_type)}:${escapeHtml(item.scope_ref || "*")} · ${escapeHtml(item.status)} · ${escapeHtml(describeGovernanceDisposition(item.governance?.disposition_status))}</span>
      <span class="knowledge-row-snippet">${escapeHtml(item.snippet || item.content || "")}</span>
    </button>
  `).join("");
}

function renderKnowledgeDetail(item) {
  const headerMeta = [describeKind(item.kind), describeStatus(item.status), describeGovernanceLevel(item.governance_level)].join(" · ");
  const candidateActions = '<button class="primary-button" data-approve>确认知识本体为 active</button><button class="ghost-button" data-reject>关闭候选</button>';
  return `
    <div class="knowledge-detail-card">
      <div class="knowledge-detail-header">
        <div>
          <div class="panel-title">${escapeHtml(headerMeta)}</div>
          <h3>${escapeHtml(item.title)}</h3>
        </div>
        <span class="badge ${escapeHtml(item.status)}">${escapeHtml(describeScope(item.scope_type, item.scope_ref))}</span>
      </div>
      ${renderKnowledgeFieldGuide(item)}
      <div class="knowledge-detail-grid">
        <section><h4>来源与追溯</h4>${renderSources(item.sources)}</section>
        <section><h4>治理进度与裁决去向</h4>${renderGovernanceSummary(item.governance)}</section>
      </div>
      <div class="governance-chat-section">
        <h4>治理对话</h4>
        <div data-governance-chat></div>
      </div>
      <div class="button-row knowledge-actions">
        ${item.status === "candidate" ? candidateActions : ""}
        ${item.status === "active" ? '<button class="ghost-button" data-deprecate>废弃</button>' : ""}
      </div>
    </div>
  `;
}

function renderKnowledgeFieldGuide(item) {
  const fields = [
    { label: "标题", value: item.title, help: "用一句话说明这条知识是什么，方便以后在知识库里快速识别。" },
    { label: "知识内容", value: item.content, help: "真正要被长期记住和复用的规则、偏好、事实、流程或结论。" },
    { label: "类型", value: describeKind(item.kind), help: "说明这条知识的性质。" },
    { label: "作用域", value: describeScope(item.scope_type, item.scope_ref), help: "说明这条知识适用于哪里；未指定具体对象表示当前作用域下全部适用。" },
    { label: "知识本体状态", value: describeStatus(item.status), help: "说明这条知识目前是候选、已确认、已关闭还是已废弃；active 只表示知识本体成立，不等同已经落地。" },
    { label: "治理等级", value: describeGovernanceLevel(item.governance_level), help: "表示这条知识被确认的强度；等级越高，通常越值得进入长期入口或作为稳定约束被引用。" },
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

function renderGovernanceSummary(governance) {
  if (!governance) return '<p class="knowledge-help-text">暂无治理记录。旧数据或受控迁移导入的知识可能没有候选治理壳。</p>';
  const fields = [
    { label: "治理对话", value: governance.conversation ? governance.conversation.title : "未创建", help: governance.conversation ? `治理对话 ID：${governance.conversation.id}` : "候选创建后应自动生成知识中心治理对话。" },
    { label: "入口校验", value: describeGovernanceEntry(governance.entry_check_status), help: "记录这条候选是否继续治理、关闭、合并或延后。" },
    { label: "查重定性", value: describeGovernanceDedupe(governance.dedupe_status), help: governance.related_knowledge_ids?.length ? `关联知识：${governance.related_knowledge_ids.join(", ")}` : "记录是否为重复、相关或全新知识。" },
    { label: "场景类型", value: describeGovernanceScenario(governance.scenario_type), help: "区分负反馈处理和新增知识审视，避免把两类工作混在一起。" },
    { label: "裁决去向", value: describeGovernanceDisposition(governance.disposition_status), help: governance.final_destination || governance.disposition_reason || "治理结束时必须记录最终落地入口、不落地原因或延后条件。" },
    { label: "产物形式", value: describeGovernanceArtifact(governance.artifact_type), help: governance.governance_pr_url || "PR 型治理应记录 PR URL；结论型治理应记录不需要 PR 的原因。" },
  ];
  return `<div class="knowledge-policy-summary">${fields.map(renderKnowledgeField).join("")}</div>`;
}

function describeKind(kind) {
  const labels = { decision: "决策：已经做出的设计或流程结论", rule: "规则：必须遵守的约束", preference: "偏好：用户或项目的长期倾向", incident: "事故：失败案例或问题复盘", anti_pattern: "反模式：明确不应采用的做法", glossary: "术语：概念定义", open_question: "开放问题：尚未关闭的治理问题", procedure: "流程：可复用操作步骤", fact: "事实：稳定事实", pattern: "模式：可复用实践" };
  return labels[kind] || kind;
}

function describeStatus(status) {
  const labels = { candidate: "候选：等待治理", active: "已确认：知识本体成立", rejected: "已关闭", superseded: "已被新知识替代", deprecated: "已废弃", archived: "已归档" };
  return labels[status] || status;
}

function describeGovernanceEntry(status) {
  const labels = { pending_entry_check: "等待入口校验", entry_check_passed: "入口校验通过", entry_check_closed: "入口已关闭", deferred: "延后治理", merged: "已合并处理" };
  return labels[status] || status || "无治理记录";
}

function describeGovernanceDedupe(status) {
  const labels = { pending: "等待查重", unique: "非重复", duplicate: "重复", related: "相关但不重复", merged: "已合并" };
  return labels[status] || status || "无治理记录";
}

function describeGovernanceScenario(status) {
  const labels = { pending: "等待定性", negative_feedback: "负反馈", new_knowledge_review: "新增知识审视" };
  return labels[status] || status || "无治理记录";
}

function describeGovernanceDisposition(status) {
  const labels = { pending: "等待裁决", conclusion_only: "仅结论", pr_required: "需要 PR", pr_open: "PR 处理中", pr_merged: "PR 已合入", landed: "已落地", reference_only: "仅参考", merged_or_superseded: "已合并或替代", closed: "已关闭", deferred: "延后" };
  return labels[status] || status || "无治理记录";
}

function describeGovernanceArtifact(type) {
  const labels = { pending: "等待确定", conclusion_only: "结论记录", system_prompt_pr: "系统提示词 PR", skill_pr: "Skill PR", core_doc_pr: "核心文档 PR", user_manual_pr: "用户手册 PR", code_or_checker_pr: "代码或检查器 PR", merge_or_supersede_record: "合并或替代记录" };
  return labels[type] || type || "无治理记录";
}

function describeGovernanceLevel(level) {
  const labels = { L0: "L0：候选或尚未完成治理判断", L1: "L1：已完成基础确认", L2: "L2：高可信，默认更适合进入长期入口", L3: "L3：强治理级别" };
  return labels[level] || level;
}

function describeScope(scopeType, scopeRef) {
  const labels = { global: "全局", project: "项目", feature: "Feature", stage: "Stage", snail: "Snail", conversation: "Conversation" };
  const target = scopeRef || "全部对象";
  return `${labels[scopeType] || scopeType}：${target}`;
}

