function nextStepText(state) {
  if (!state.currentWorkspace) return "选择项目以开始。";
  if (!state.currentFeature) return "选择或新建 Feature。";
  if (state.currentFeature.closed_at !== null) return "已归档 Feature 仅支持查看历史上下文。";
  if (!state.currentStage) return "当前 Feature 没有活跃阶段。";
  if (!state.currentConversation) return "选择或新建 conversation。";
  if (state.currentStage.status === "in_progress") return "先补齐输出产物，再决定是否推进阶段。";
  if (state.currentStage.status === "in_review") return "等待检视意见处理完成后再推进。";
  if (state.currentStage.status === "approved") return "当前阶段已完成，可推进下一阶段。";
  return `当前阶段状态：${state.currentStage.status}`;
}

function buildParticipants(state) {
  const roleDefs = Array.isArray(state.currentStage?.role_definitions) ? state.currentStage.role_definitions : [];
  const conversationNames = Array.isArray(state.currentConversation?.participating_roles) ? state.currentConversation.participating_roles : [];
  const participantsByName = new Map();

  roleDefs.forEach((roleDef) => {
    const name = roleDef.name;
    if (!name) return;
    participantsByName.set(name, {
      name,
      roleDef,
      isPrimary: Boolean(roleDef.is_primary) || state.currentConversation?.default_role === name,
    });
  });

  conversationNames.forEach((name) => {
    if (participantsByName.has(name)) return;
    participantsByName.set(name, {
      name,
      roleDef: null,
      isPrimary: state.currentConversation?.default_role === name,
    });
  });

  return Array.from(participantsByName.values());
}

function renderParticipant(participant, escapeHtml, { templates, featureId, stageId }) {
  const roleName = participant.roleDef?.name || participant.name;
  const roleLabel = participant.name === "Boss Role" ? "用户" : "协作角色";
  const description = participant.roleDef?.description || "暂无职责说明";
  const rules = Array.isArray(participant.roleDef?.working_rules) ? participant.roleDef.working_rules : [];
  const currentTemplateId = participant.roleDef?.snail_template_id;
  const templateSelect = (templates && templates.length && currentTemplateId && roleName !== "Boss Role" && featureId && stageId)
    ? `<select class="participant-snail-select" data-role="${escapeHtml(roleName)}">${templates.map((t) => `<option value="${escapeHtml(t.id)}" ${t.id === currentTemplateId ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}</select>`
    : (currentTemplateId ? `<span class="participant-runtime">${escapeHtml(currentTemplateId)}</span>` : "");
  const detail = [description, ...rules].filter(Boolean).join("\n");
  return `
    <div class="participant-card" title="${escapeHtml(detail)}">
      <div class="participant-card-head">
        <div>
          <div class="participant-role">${escapeHtml(roleName)}${participant.isPrimary ? '<span class="primary-chip">主响应</span>' : ""}</div>
          <div class="participant-snail">${escapeHtml(roleLabel)}</div>
        </div>
        ${templateSelect}
      </div>
      <p>${escapeHtml(description)}</p>
      ${rules.length ? `<div class="participant-rules">${rules.slice(0, 2).map((rule) => `<span>${escapeHtml(rule)}</span>`).join("")}</div>` : ""}
    </div>
  `;
}

/**
 * 渲染 key-value 产物对。每个产物显示为 key: value pill，可单独删除。
 */
function renderArtifactEntries(artifacts, escapeHtml, options) {
  if (!artifacts || typeof artifacts !== "object") return "";
  const entries = Object.entries(artifacts);
  return entries.map(([key, value]) => `
    <div class="deliverable-pill ${options.isInput ? "input" : "output"}" title="${escapeHtml(`${key}: ${value}`)}">
      <span class="artifact-key">${escapeHtml(key)}</span>
      <span class="artifact-value">${escapeHtml(value)}</span>
      ${options.removable ? `<button class="deliverable-remove" data-remove-artifact="${escapeHtml(key)}" aria-label="移除输出产物">×</button>` : ""}
    </div>
  `).join("");
}

function renderConversationContextBlock(state, escapeHtml) {
  const sources = Array.isArray(state.currentConversationSources) ? state.currentConversationSources : [];
  const sourceText = sources.length
    ? sources.map((source) => source.title || `Conversation #${source.id}`).join("\n")
    : "无来源 conversation";
  return `
    <div class="context-line"><span>Workspace</span><span title="${escapeHtml(state.currentWorkspace?.name || "未选择")}">${escapeHtml(state.currentWorkspace?.name || "未选择")}</span></div>
    <div class="context-line"><span>Feature</span><span title="${escapeHtml(state.currentFeature?.title || "未选择")}">${escapeHtml(state.currentFeature?.title || "未选择")}</span></div>
    <div class="context-line"><span>Conversation</span><span title="${escapeHtml(state.currentConversation?.title || "未选择")}">${escapeHtml(state.currentConversation?.title || "未选择")}</span></div>
    <div class="context-note" title="${escapeHtml(sourceText)}"><span>来源 conversation</span><p>${escapeHtml(sourceText)}</p></div>
  `;
}

function renderWorkspaceSummaryCard(elements, state, stageTitle, escapeHtml) {
  if (!state.currentWorkspace) {
    elements.workspaceSummaryCard.innerHTML = '<div class="name">未选择项目</div><div class="meta">选择项目后查看当前协作线</div>';
    return;
  }
  const stageLabel = state.currentStage ? stageTitle(state.currentStage.type) : "无阶段";
  const pending = state.currentWorkspace.boss_pending_count > 0 ? ` · @${state.currentWorkspace.boss_pending_count}` : "";
  elements.workspaceSummaryCard.innerHTML = `
    <div class="name">${escapeHtml(state.currentWorkspace.name)}</div>
    <div class="meta">${escapeHtml(state.currentWorkspace.kind)} · ${escapeHtml(state.currentWorkspace.status)}${escapeHtml(pending)}</div>
    <div class="meta" style="margin-top: 8px;">当前 Feature：${escapeHtml(state.currentFeature?.title || "未选择")}</div>
    <div class="meta" style="margin-top: 4px;">当前阶段：${escapeHtml(stageLabel)}</div>
  `;
}

function renderRepoContextSummary(state, escapeHtml, renderRepoContextCard, readonly, onEditRepoContext, { api, onUpdated, onRefresh, showNotice }) {
  const repoContextCard = document.getElementById("repo-context-summary-card");
  const repoContextEditButton = document.getElementById("repo-context-edit-btn");
  if (renderRepoContextCard) {
    renderRepoContextCard({
      card: repoContextCard,
      editButton: repoContextEditButton,
      stage: state.currentStage,
      readonly,
      escapeHtml,
      api,
      onUpdated,
      onRefresh,
      showNotice,
    });
  }
  if (repoContextEditButton) repoContextEditButton.onclick = () => onEditRepoContext?.();
}

function renderAdvanceActions({ canAdvance, canRestart, readonly }) {
  const advanceDisabled = canAdvance ? "" : "disabled";
  const advanceTitle = readonly ? "已归档 Feature 不能推进阶段" : "输出产物满足后推进阶段";
  const restartDisabled = canRestart ? "" : "disabled";
  const restartTitle = readonly ? "已归档 Feature 不能开启新研发迭代" : (canRestart ? "在当前 Feature 下开启新研发迭代" : "仅当前 Feature 的进行中研发或等待合入的检视阶段可返工");
  return `<div class="stage-action-row">
              <button class="secondary-button stage-action-btn" type="button" data-stage-action="advance" ${advanceDisabled} title="${advanceTitle}">推进阶段</button>
              <button class="ghost-button stage-action-btn" type="button" data-stage-action="restart" ${restartDisabled} title="${restartTitle}">重开研发</button>
            </div>`;
}

async function upsertOutputArtifact({ keyElement, valueElement, state, api, showNotice, onRefresh }) {
  const key = keyElement.value.trim();
  const value = valueElement.value.trim();
  if (!key || !value || !state.currentStage) return;
  const current = getArtifactsRecord(state.currentStage);
  if (current[key] === value) { keyElement.value = ""; valueElement.value = ""; return; }
  current[key] = value;
  try {
    const updated = await api("PATCH", `/stages/${state.currentStage.id}`, { output_artifacts: current });
    state.currentStage = updated;
    state.stages = state.stages.map((s) => s.id === updated.id ? updated : s);
    keyElement.value = ""; valueElement.value = "";
    showNotice?.("已记录输出产物「" + key + "」");
    onRefresh?.();
  } catch (err) { showNotice?.("记录失败：" + err.message, true); }
}

async function deleteOutputArtifact({ key, state, api, showNotice, onRefresh }) {
  if (!state.currentStage) return;
  const current = getArtifactsRecord(state.currentStage);
  delete current[key];
  try {
    const updated = await api("PATCH", `/stages/${state.currentStage.id}`, { output_artifacts: current });
    state.currentStage = updated;
    state.stages = state.stages.map((s) => s.id === updated.id ? updated : s);
    showNotice?.("已移除输出产物「" + key + "」");
    onRefresh?.();
  } catch (err) { showNotice?.("移除失败：" + err.message, true); }
}

function getArtifactsRecord(stage) {
  const raw = stage?.output_artifacts;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  return {};
}

function renderWorkspaceProgressCard({ elements, state, stageTitle, escapeHtml, api, onAdvanceStage, onRestartDevelopment, canRestartFeatureDevelopment, isReadonly, onRefresh, getTemplates, showNotice }) {
  const stage = state.currentStage;
  const workspace = state.currentWorkspace;
  const feature = state.currentFeature;
  const currentConversation = state.currentConversation;
  const readonly = Boolean(isReadonly?.());
  const nextStep = nextStepText(state);

  if (!stage || !workspace || !feature || !currentConversation) {
    elements.workspaceProgressCard.innerHTML = `
      <div class="context-card-header">
        <div class="context-card-title">当前推进</div>
      </div>
      <div class="empty-state">选择项目、Feature、阶段和 conversation 后查看推进闭环。</div>
    `;
    return;
  }

  const title = `${stageTitle(stage.type)} #${stage.sequence}`;
  const definition = stage.stage_definition;
  const inputArtifacts = stage.input_artifacts && typeof stage.input_artifacts === "object" && !Array.isArray(stage.input_artifacts) ? stage.input_artifacts : {};
  const outputArtifacts = stage.output_artifacts && typeof stage.output_artifacts === "object" && !Array.isArray(stage.output_artifacts) ? stage.output_artifacts : {};
  const outputCount = Object.keys(outputArtifacts).length;
  const inputCount = Object.keys(inputArtifacts).length;
  const inputDescription = definition?.input_description || "";
  const outputDescription = definition?.output_description || "";
  const participants = buildParticipants(state);
  const canAdvance = Boolean(state.currentFeature && state.currentStage && !readonly);
  const canRestart = Boolean(canRestartFeatureDevelopment?.(state.currentFeature, state.currentStage)) && !readonly;
  const outputEntries = renderArtifactEntries(outputArtifacts, escapeHtml, { removable: !readonly && !feature.closed_at, isInput: false });
  const inputEntries = renderArtifactEntries(inputArtifacts, escapeHtml, { removable: false, isInput: true });
  const templates = typeof getTemplates === "function" ? getTemplates() : [];
  const participantOpts = { templates, featureId: feature?.id, stageId: stage?.id, onSnailChange: onRefresh };
  elements.workspaceProgressCard.innerHTML = `
    <div class="context-card-header">
      <div>
        <div class="context-card-title">当前推进</div>
        <div class="context-hero" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      </div>
    </div>

    <div class="context-subtitle-row">
      <span class="chip hot">${escapeHtml(stage.status)}</span>
      <span class="chip">${escapeHtml(feature.title || "未选择 Feature")}</span>
      <span class="chip">${escapeHtml(currentConversation.title || "未选择 conversation")}</span>
    </div>

    <section class="context-block">
      <div class="context-block-title">推进闭环</div>
      <div class="gate-stack">
        <div class="gate-step">
          <div class="gate-step-index">1</div>
          <div class="gate-step-body">
            <strong>确认本阶段要交付什么</strong>
            <p title="${escapeHtml(nextStep)}">${escapeHtml(nextStep)}</p>
          </div>
        </div>
        <div class="gate-step gate-step-primary">
          <div class="gate-step-index">2</div>
          <div class="gate-step-body">
            <strong>补齐输出产物</strong>
            ${outputDescription ? `<p class="compact-text" title="${escapeHtml(outputDescription)}">${escapeHtml(outputDescription)}</p>` : ""}
            <div class="artifact-group">
              <div class="artifact-section-title"><span>输出产物</span><span>${outputCount}</span></div>
              <div class="deliverable-stack">${outputEntries || '<div class="empty-state">暂无输出产物</div>'}</div>
            </div>
            ${readonly ? "" : `<div class="artifact-add-row">
              <input type="text" class="artifact-input artifact-key-input" placeholder="键（如 pr_url）" list="artifact-key-list">
              <datalist id="artifact-key-list">
                <option value="branch_name">
                <option value="worktree_path">
                <option value="pr_url">
              </datalist>
              <input type="text" class="artifact-input artifact-value-input" placeholder="值（如 https://...）">
              <button class="artifact-add-btn" type="button">添加</button>
            </div>`}
          </div>
        </div>
        <div class="gate-step">
          <div class="gate-step-index">3</div>
          <div class="gate-step-body">
            <strong>推进到下一阶段</strong>
            <p>输出产物完整后再推进阶段，避免把未完成的交付推进到下一步。</p>
            ${renderAdvanceActions({ canAdvance, canRestart, readonly })}
          </div>
        </div>
      </div>
    </section>

    <section class="context-block">
      <div class="context-block-title">谁在执行</div>
      <div class="participant-stack">${participants.length ? participants.map((participant) => renderParticipant(participant, escapeHtml, participantOpts)).join("") : '<div class="empty-state">当前 conversation 未声明参与者</div>'}</div>
    </section>

    <section class="context-block">
      <div class="context-block-title">上下文来源</div>
      ${renderConversationContextBlock(state, escapeHtml)}
    </section>

    <section class="context-block">
      <div class="context-block-title">本阶段要求</div>
      ${inputDescription ? `<div class="context-note compact-text"><span>输入说明</span><p title="${escapeHtml(inputDescription)}">${escapeHtml(inputDescription)}</p></div>` : ""}
      <div class="artifact-section-title"><span>输入产物</span><span>${inputCount}</span></div>
      <div class="deliverable-stack">${inputEntries || '<div class="empty-state">暂无输入产物</div>'}</div>
    </section>
  `;

  const keyInput = elements.workspaceProgressCard.querySelector(".artifact-key-input");
  const valueInput = elements.workspaceProgressCard.querySelector(".artifact-value-input");
  const addBtn = elements.workspaceProgressCard.querySelector(".artifact-add-btn");
  if (!readonly && addBtn && keyInput && valueInput) {
    addBtn.addEventListener("click", () => upsertOutputArtifact({ keyElement: keyInput, valueElement: valueInput, state, api, showNotice, onRefresh }));
    valueInput.addEventListener("keydown", (e) => { if (e.key === "Enter") upsertOutputArtifact({ keyElement: keyInput, valueElement: valueInput, state, api, showNotice, onRefresh }); });
  }
  elements.workspaceProgressCard.querySelectorAll("[data-remove-artifact]").forEach((btn) => {
    btn.addEventListener("click", () => deleteOutputArtifact({ key: btn.getAttribute("data-remove-artifact"), state, api, showNotice, onRefresh }));
  });
  elements.workspaceProgressCard.querySelector('[data-stage-action="advance"]')?.addEventListener("click", () => onAdvanceStage?.());
  elements.workspaceProgressCard.querySelector('[data-stage-action="restart"]')?.addEventListener("click", () => onRestartDevelopment?.());
  elements.workspaceProgressCard.querySelectorAll(".participant-snail-select").forEach((select) => {
    select.addEventListener("change", () => onSnailSelectChange(select, { state, api, onRefresh }));
  });

  async function onSnailSelectChange(select, { state, api, onRefresh }) {
    const roleName = select.getAttribute("data-role");
    const newTemplateId = select.value;
    if (!roleName || !newTemplateId || !state.currentFeature?.id || !state.currentStage?.id) return;
    try {
      await api("PATCH", `/features/${state.currentFeature.id}/role-snail`, {
        stage_id: state.currentStage.id,
        role_name: roleName,
        snail_template_id: newTemplateId,
      });
      // 重新拉取 stage 以获取后端叠加 mapping 后的 StageDetail
      const updated = await api("GET", `/stages/${state.currentStage.id}`);
      if (updated) state.currentStage = updated;
      onRefresh?.();
    } catch {
      // Revert select on error
      onRefresh?.();
    }
  }
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
  getTemplates,
  showNotice,
}) {
  function nextStepTextForState() {
    return nextStepText(state);
  }

  function renderWorkspaceSummary() {
    renderWorkspaceSummaryCard(elements, state, stageTitle, escapeHtml);
  }

  function renderContextRail() {
    renderRepoContextSummary(state, escapeHtml, renderRepoContextCard, Boolean(isReadonly?.()), onEditRepoContext, { api, onUpdated: (updatedStage) => {
      state.currentStage = updatedStage;
      state.stages = state.stages.map((s) => s.id === updatedStage.id ? updatedStage : s);
      if (state.currentFeature) {
        state.currentFeature.stages = state.currentFeature.stages.map((s) => s.id === updatedStage.id ? updatedStage : s);
        state.currentFeature.current_stage = state.currentFeature.current_stage?.id === updatedStage.id ? updatedStage : state.currentFeature.current_stage;
      }
    }, onRefresh: renderContextRail, showNotice });
    renderWorkspaceSummary();
    renderWorkspaceProgressCard({
      elements,
      state,
      stageTitle,
      escapeHtml,
      api,
      onAdvanceStage,
      onRestartDevelopment,
      canRestartFeatureDevelopment,
      isReadonly,
      onRefresh: renderContextRail,
      getTemplates,
      showNotice,
    });
  }

  return {
    nextStepText: nextStepTextForState,
    renderContextRail,
    renderWorkspaceSummary,
  };
}
