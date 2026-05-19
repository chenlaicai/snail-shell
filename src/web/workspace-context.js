function nextStepText(state) {
  if (!state.currentProject) return "选择项目以开始。";
  if (!state.currentFeature) return "选择或新建 Feature。";
  if (state.currentFeature.status === "archived") return "已归档 Feature 仅支持查看历史上下文。";
  if (!state.currentStage) return "当前 Feature 没有活跃阶段。";
  if (!state.currentConversation) return "选择或新建 conversation。";
  if (state.currentStage.status === "in_progress") return "继续讨论、实现或沉淀正式交付。";
  if (state.currentStage.status === "in_review") return "等待检视意见处理完成。";
  if (state.currentStage.status === "approved") return "当前阶段已完成，可推进下一阶段。";
  return `当前阶段状态：${state.currentStage.status}`;
}

function buildParticipants(state) {
  const roleDefs = Array.isArray(state.currentStage?.role_definitions) ? state.currentStage.role_definitions : [];
  const conversationNames = Array.isArray(state.currentConversation?.participating_snails) ? state.currentConversation.participating_snails : [];
  const participantsByName = new Map();
  roleDefs.forEach((roleDef) => {
    const name = roleDef.name;
    if (!name) return;
    participantsByName.set(name, {
      name,
      roleDef,
      snail: state.snails.find((item) => item.name === name),
      isPrimary: Boolean(roleDef.is_primary) || state.currentConversation?.default_snail === name,
    });
  });
  conversationNames.forEach((name) => {
    if (participantsByName.has(name)) return;
    participantsByName.set(name, {
      name,
      roleDef: null,
      snail: state.snails.find((item) => item.name === name),
      isPrimary: state.currentConversation?.default_snail === name,
    });
  });
  return Array.from(participantsByName.values());
}

function renderParticipant(participant, escapeHtml) {
  const roleName = participant.roleDef?.role || participant.roleDef?.name || (participant.name === "Boss Role" ? "用户" : "协作角色");
  const snailName = participant.snail?.name || participant.name;
  const description = participant.roleDef?.description || participant.snail?.description || "暂无职责说明";
  const rules = Array.isArray(participant.roleDef?.working_rules) ? participant.roleDef.working_rules : [];
  const runtime = participant.snail?.runtime ? `<span>${escapeHtml(participant.snail.runtime)}</span>` : "";
  const detail = [description, ...rules].filter(Boolean).join("\n");
  return `
    <div class="participant-card" title="${escapeHtml(detail)}">
      <div class="participant-card-head">
        <div>
          <div class="participant-role">${escapeHtml(roleName)}${participant.isPrimary ? '<span class="primary-chip">主响应</span>' : ""}</div>
          <div class="participant-snail">${escapeHtml(snailName)}</div>
        </div>
        ${runtime}
      </div>
      <p>${escapeHtml(description)}</p>
      ${rules.length ? `<div class="participant-rules">${rules.slice(0, 2).map((rule) => `<span>${escapeHtml(rule)}</span>`).join("")}</div>` : ""}
    </div>
  `;
}

function renderArtifactPills(artifacts, escapeHtml, options) {
  return artifacts.map((artifact) => `
    <div class="deliverable-pill ${options.isInput ? "input" : "output"}" title="${escapeHtml(artifact)}">
      <span>${escapeHtml(artifact)}</span>
      ${options.removable ? `<button class="deliverable-remove" data-remove-artifact="${escapeHtml(artifact)}" aria-label="移除输出产物">×</button>` : ""}
    </div>
  `).join("");
}

function renderConversationContextHtml(state, escapeHtml) {
  const sources = Array.isArray(state.currentConversationSources) ? state.currentConversationSources : [];
  const sourceText = sources.length
    ? sources.map((source) => source.title || `Conversation #${source.id}`).join("\n")
    : "无来源 conversation";
  return `
    <div class="context-card-header"><div class="context-card-title">Context</div></div>
    <div class="context-line"><span>Project</span><span title="${escapeHtml(state.currentProject?.name || "未选择")}">${escapeHtml(state.currentProject?.name || "未选择")}</span></div>
    <div class="context-line"><span>Feature</span><span title="${escapeHtml(state.currentFeature?.title || "未选择")}">${escapeHtml(state.currentFeature?.title || "未选择")}</span></div>
    <div class="context-line"><span>Conversation</span><span title="${escapeHtml(state.currentConversation?.title || "未选择")}">${escapeHtml(state.currentConversation?.title || "未选择")}</span></div>
    <div class="context-note" title="${escapeHtml(sourceText)}"><span>来源上下文</span><p>${escapeHtml(sourceText)}</p></div>
  `;
}

export function createWorkspaceContext({
  elements,
  state,
  stageTitle,
  escapeHtml,
  api,
  renderRepoContextCard,
  onEditRepoContext,
  onAdvanceStage,
  onRestartDevelopment,
  canRestartFeatureDevelopment,
  isReadonly,
}) {
  function nextStepTextForState() {
    return nextStepText(state);
  }

  function renderProjectSummary() {
    if (!state.currentProject) {
      elements.projectSummaryCard.innerHTML = '<div class="name">未选择项目</div><div class="meta">选择项目后查看当前协作线</div>';
      return;
    }
    const stageLabel = state.currentStage ? stageTitle(state.currentStage.type) : "无阶段";
    const pending = state.currentProject.boss_pending_count > 0 ? ` · @${state.currentProject.boss_pending_count}` : "";
    elements.projectSummaryCard.innerHTML = `
      <div class="name">${escapeHtml(state.currentProject.name)}</div>
      <div class="meta">${escapeHtml(state.currentProject.kind)} · ${escapeHtml(state.currentProject.status)}${escapeHtml(pending)}</div>
      <div class="meta" style="margin-top: 8px;">当前 Feature：${escapeHtml(state.currentFeature?.title || "未选择")}</div>
      <div class="meta" style="margin-top: 4px;">当前阶段：${escapeHtml(stageLabel)}</div>
    `;
  }

  function renderStageSummary() {
    const stage = state.currentStage;
    if (!stage) {
      elements.stageSummaryCard.innerHTML = `
        <div class="context-card-header"><div class="context-card-title">Stage</div></div>
        <div class="empty-state">暂无活跃阶段</div>
      `;
      return;
    }
    const definition = stage.stage_definition;
    const title = `${stageTitle(stage.type)} #${stage.sequence}`;
    const goal = definition?.output_description || "推进当前 conversation";
    const nextStep = nextStepTextForState();
    const readonly = Boolean(isReadonly?.());
    const canAdvance = Boolean(state.currentFeature && state.currentStage && !readonly);
    const canRestart = Boolean(canRestartFeatureDevelopment?.(state.currentFeature, state.currentStage)) && !readonly;
    elements.stageSummaryCard.innerHTML = `
      <div class="context-card-header"><div class="context-card-title">Stage</div></div>
      <div class="context-hero" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      <div class="context-line"><span>状态</span><span><span class="badge ${escapeHtml(stage.status)}">${escapeHtml(stage.status)}</span></span></div>
      <div class="context-line"><span>Feature</span><span title="${escapeHtml(state.currentFeature?.title || "未选择")}">${escapeHtml(state.currentFeature?.title || "未选择")}</span></div>
      <div class="context-note" title="${escapeHtml(goal)}"><span>目标</span><p>${escapeHtml(goal)}</p></div>
      <div class="context-note" title="${escapeHtml(nextStep)}"><span>下一步</span><p>${escapeHtml(nextStep)}</p></div>
      <div class="stage-action-row">
        <button class="secondary-button stage-action-btn" type="button" data-stage-action="advance" ${canAdvance ? "" : "disabled"} title="${readonly ? "已归档 Feature 不能推进阶段" : "推进当前 Feature 工作流"}">推进阶段</button>
        <button class="ghost-button stage-action-btn" type="button" data-stage-action="restart" ${canRestart ? "" : "disabled"} title="${readonly ? "已归档 Feature 不能开启新研发迭代" : canRestart ? "在当前 Feature 下开启新研发迭代" : "仅当前 Feature 的进行中研发或等待合入的检视阶段可返工"}">重开研发</button>
      </div>
    `;
    elements.stageSummaryCard.querySelector('[data-stage-action="advance"]')?.addEventListener("click", () => onAdvanceStage?.());
    elements.stageSummaryCard.querySelector('[data-stage-action="restart"]')?.addEventListener("click", () => onRestartDevelopment?.());
  }

  function renderParticipantsSummary() {
    const participants = buildParticipants(state);
    const items = participants.length ? participants.map((participant) => renderParticipant(participant, escapeHtml)).join("") : '<div class="empty-state">当前 conversation 未声明参与者</div>';
    elements.participantsSummaryCard.innerHTML = `
      <div class="context-card-header"><div class="context-card-title">Participants</div></div>
      <div class="participant-stack">${items}</div>
    `;
  }

  function renderConversationContext() {
    elements.conversationContextCard.innerHTML = renderConversationContextHtml(state, escapeHtml);
  }

  function renderDeliverablesSummary() {
    const stage = state.currentStage;
    const inputArtifacts = stage?.input_artifacts || [];
    const outputArtifacts = stage?.output_artifacts || [];
    const definition = stage?.stage_definition;
    const inputDescription = definition?.input_description || "";
    const outputDescription = definition?.output_description || "";
    const isArchived = state.currentFeature?.status === "archived";
    const inputPills = renderArtifactPills(inputArtifacts, escapeHtml, { removable: false, isInput: true });
    const outputPills = renderArtifactPills(outputArtifacts, escapeHtml, { removable: !isArchived, isInput: false });
    elements.deliverablesSummaryCard.innerHTML = `
      <div class="context-card-header"><div class="context-card-title">Artifacts</div></div>
      <div class="artifact-section">
        <div class="artifact-section-title">输入产物 <span>${inputArtifacts.length}</span></div>
        ${inputDescription ? `<div class="context-note compact" title="${escapeHtml(inputDescription)}"><p>${escapeHtml(inputDescription)}</p></div>` : ""}
        <div class="deliverable-stack">${inputPills || '<div class="empty-state">暂无输入产物</div>'}</div>
      </div>
      <div class="artifact-section">
        <div class="artifact-section-title">输出产物 <span>${outputArtifacts.length}</span></div>
        ${outputDescription ? `<div class="context-note compact" title="${escapeHtml(outputDescription)}"><p>${escapeHtml(outputDescription)}</p></div>` : ""}
        <div class="deliverable-stack">${outputPills || '<div class="empty-state">暂无输出产物</div>'}</div>
      </div>
      ${isArchived ? "" : `<div class="artifact-add-row"><input type="text" class="artifact-input" placeholder="添加输出产物..."><button class="artifact-add-btn">添加</button></div>`}
    `;
    if (!isArchived) {
      const input = elements.deliverablesSummaryCard.querySelector(".artifact-input");
      const addBtn = elements.deliverablesSummaryCard.querySelector(".artifact-add-btn");
      if (addBtn && input) {
        addBtn.addEventListener("click", () => addOutputArtifact(input));
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") addOutputArtifact(input); });
      }
      elements.deliverablesSummaryCard.querySelectorAll("[data-remove-artifact]").forEach((btn) => {
        btn.addEventListener("click", () => removeOutputArtifact(btn.getAttribute("data-remove-artifact")));
      });
    }
  }

  async function addOutputArtifact(input) {
    const value = input.value.trim();
    if (!value || !state.currentStage) return;
    const current = state.currentStage.output_artifacts || [];
    if (current.includes(value)) { input.value = ""; return; }
    const updated = await api("PATCH", `/stages/${state.currentStage.id}`, { output_artifacts: [...current, value] });
    state.currentStage = updated;
    state.stages = state.stages.map((s) => s.id === updated.id ? updated : s);
    renderContextRail();
  }

  async function removeOutputArtifact(artifact) {
    if (!state.currentStage) return;
    const current = state.currentStage.output_artifacts || [];
    const updated = await api("PATCH", `/stages/${state.currentStage.id}`, { output_artifacts: current.filter((a) => a !== artifact) });
    state.currentStage = updated;
    state.stages = state.stages.map((s) => s.id === updated.id ? updated : s);
    renderContextRail();
  }

  function renderContextRail() {
    const repoContextCard = document.getElementById("repo-context-summary-card");
    const repoContextEditButton = document.getElementById("repo-context-edit-btn");
    renderStageSummary();
    renderParticipantsSummary();
    renderConversationContext();
    if (renderRepoContextCard) {
      renderRepoContextCard({ card: repoContextCard, editButton: repoContextEditButton, feature: state.currentFeature, readonly: Boolean(isReadonly?.()), escapeHtml });
    }
    if (repoContextEditButton) repoContextEditButton.onclick = () => onEditRepoContext?.();
    renderDeliverablesSummary();
  }

  return {
    nextStepText: nextStepTextForState,
    renderContextRail,
    renderProjectSummary,
  };
}
