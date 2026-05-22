import { escapeHtml } from "./message-view.js";
import { renderMessages } from "./message-renderer.js";

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

  /**
   * 渲染中央面板：未选中知识时显示引导提示，选中时渲染完整对话布局。
   * 对话布局由三部分组成：顶部紧凑知识信息卡、中间消息列表、底部输入区。
   * 整体填充 .main-panel 高度，消息列表 flex:1 可滚动。
   */
  function renderDetail() {
    elements.detail.innerHTML = state.selected
      ? renderConversationLayout(state.selected)
      : '<div class="empty-state">选择一条知识查看来源、治理对话和裁决去向</div>';

    if (state.selected) {
      renderGovernanceMessagesIntoContainer();
      bindDetailEvents();
    }
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
    input.disabled = true;
    const sendBtn = elements.detail.querySelector("[data-governance-send]");
    if (sendBtn) sendBtn.disabled = true;
    try {
      await api("POST", `/knowledge/${state.selected.id}/governance-conversation/messages`, {
        content,
        from_role: "Boss Role",
      });
      await loadGovernanceMessages();
    } catch (err) {
      showNotice(`发送失败：${err.message}`, true);
    } finally {
      input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
    }
  }

  async function loadGovernanceMessages() {
    if (!state.selected) return;
    try {
      state.governanceMessages = await api("GET", `/knowledge/${state.selected.id}/governance-conversation/messages`);
      renderGovernanceMessagesIntoContainer();
    } catch {
      // ignore
    }
  }

  function renderGovernanceMessagesIntoContainer() {
    const container = elements.detail.querySelector("#governance-messages");
    if (!container) return;
    renderGovernanceMessages(container, state);
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

// ── 对话布局渲染 ──

function renderConversationLayout(item) {
  const headerMeta = [describeKind(item.kind), describeStatus(item.status), describeGovernanceLevel(item.governance_level)].join(" · ");
  const headerBadge = `<span class="badge ${escapeHtml(item.status)}">${escapeHtml(describeScope(item.scope_type, item.scope_ref))}</span>`;
  const gov = item.governance;

  let headerActions = "";
  if (item.status === "candidate") {
    headerActions = `<div class="knowledge-header-actions">
      <button class="primary-button" data-approve>确认知识本体为 active</button>
      <button class="ghost-button" data-reject>关闭候选</button>
    </div>`;
  } else if (item.status === "active") {
    headerActions = `<div class="knowledge-header-actions">
      <button class="ghost-button" data-deprecate>废弃</button>
    </div>`;
  }

  return `
    <div class="knowledge-conversation-header">
      <div class="knowledge-conversation-title-bar">
        <span class="panel-title">${escapeHtml(headerMeta)}</span>
        <h2>${escapeHtml(item.title)}</h2>
        ${headerBadge}
      </div>
      <div class="knowledge-conversation-meta">
        <span><span class="label">内容</span><span class="value">${escapeHtml(truncate(item.content, 120))}</span></span>
        ${item.rationale ? `<span><span class="label">理由</span><span class="value">${escapeHtml(truncate(item.rationale, 80))}</span></span>` : ""}
        ${gov ? `
          <span><span class="label">入口校验</span><span class="value">${escapeHtml(describeGovernanceEntry(gov.entry_check_status))}</span></span>
          <span><span class="label">查重</span><span class="value">${escapeHtml(describeGovernanceDedupe(gov.dedupe_status))}</span></span>
          <span><span class="label">场景</span><span class="value">${escapeHtml(describeGovernanceScenario(gov.scenario_type))}</span></span>
          <span><span class="label">裁决</span><span class="value">${escapeHtml(describeGovernanceDisposition(gov.disposition_status))}</span></span>
        ` : ""}
      </div>
      ${headerActions}
    </div>
    <div class="governance-messages" id="governance-messages"></div>
    <div class="governance-composer">
      <textarea data-governance-input placeholder="输入消息与 知识执行者 讨论此知识的治理…" rows="2"></textarea>
      <button class="primary-button governance-send-btn" data-governance-send>发送</button>
    </div>
  `;
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// ── 消息列表渲染 ──

function renderGovernanceMessages(container, state) {
  const msgs = state?.governanceMessages;
  if (!msgs?.length) {
    container.innerHTML = '<div class="empty-state">暂无消息，在下方输入框开始对话以治理此知识</div>';
    return;
  }
  // Adapt governance messages to the format expected by the shared renderMessages
  const records = msgs.map((msg) => ({
    ...msg,
    // Ensure events array exists for message-renderer
    events: msg.events || [],
  }));
  const byPersistedId = new Map();
  records.forEach((r) => { if (r.id != null) byPersistedId.set(r.id, r); });
  renderMessages(container, { records, byPersistedId }, {});
  container.scrollTop = container.scrollHeight;
}

// ── 侧边栏摘要 ──

function renderSummary(state, project) {
  const active = state.items.filter((item) => item.status === "active").length;
  const modeTitle = state.mode === "candidates" ? "待治理候选" : state.mode === "project" && project ? `${escapeHtml(project.name)} · 项目知识` : "知识库";
  return `
    <div class="knowledge-directory-summary">
      <div>
        <div class="panel-title">Knowledge Center</div>
        <h3>${modeTitle}</h3>
        <p>选择一条知识后在中央面板开始治理对话。</p>
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

// ── 状态标签 ──

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

function describeGovernanceLevel(level) {
  const labels = { L0: "L0：候选或尚未完成治理判断", L1: "L1：已完成基础确认", L2: "L2：高可信，默认更适合进入长期入口", L3: "L3：强治理级别" };
  return labels[level] || level;
}

function describeScope(scopeType, scopeRef) {
  const labels = { global: "全局", project: "项目", feature: "Feature", stage: "Stage", snail: "Snail", conversation: "Conversation" };
  const target = scopeRef || "全部对象";
  return `${labels[scopeType] || scopeType}：${target}`;
}
