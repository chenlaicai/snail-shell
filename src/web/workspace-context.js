export function createWorkspaceContext({
  elements,
  state,
  stageTitle,
  escapeHtml,
  api,
}) {
  function nextStepText() {
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

  function setInspectorTab(tab) {
    Array.from(document.querySelectorAll("[data-inspector-tab]")).forEach((button) => {
      button.className = "inspector-tab" + (button.getAttribute("data-inspector-tab") === tab ? " active" : "");
    });
    Array.from(document.querySelectorAll("[data-inspector-pane]")).forEach((pane) => {
      pane.className = "inspector-pane" + (pane.getAttribute("data-inspector-pane") === tab ? " active" : "");
    });
  }

  function openInspector(tab = "stage") {
    setInspectorTab(tab);
    elements.drawerBackdrop.className = "drawer-backdrop visible";
    elements.inspectorDrawer.className = "inspector-drawer visible";
    elements.inspectorDrawer.setAttribute("aria-hidden", "false");
  }

  function closeInspector() {
    elements.drawerBackdrop.className = "drawer-backdrop";
    elements.inspectorDrawer.className = "inspector-drawer";
    elements.inspectorDrawer.setAttribute("aria-hidden", "true");
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
        <div class="context-card-header"><div class="context-card-title">Stage</div><button class="context-card-link" data-inspector-open="stage">详情</button></div>
        <div class="empty-state">暂无活跃阶段</div>
      `;
      return;
    }
    const definition = stage.stage_definition;
    elements.stageSummaryCard.innerHTML = `
      <div class="context-card-header"><div class="context-card-title">Stage</div><button class="context-card-link" data-inspector-open="stage">详情</button></div>
      <div class="context-line"><span>当前</span><span>${escapeHtml(stageTitle(stage.type))} #${stage.sequence}</span></div>
      <div class="context-line"><span>状态</span><span><span class="badge ${escapeHtml(stage.status)}">${escapeHtml(stage.status)}</span></span></div>
      <div class="context-line"><span>目标</span><span>${escapeHtml(definition?.output_description || "推进当前 conversation")}</span></div>
      <div class="context-line"><span>下一步</span><span>${escapeHtml(nextStepText())}</span></div>
    `;
  }

  function renderParticipantsSummary() {
    const names = Array.isArray(state.currentConversation?.participating_snails) ? state.currentConversation.participating_snails : [];
    const primary = state.currentConversation?.default_snail || names[0] || "无";
    const items = names.length ? names.map((name) => {
      const snail = state.snails.find((item) => item.name === name);
      const role = name === primary ? "主响应" : name === "Boss Role" ? "用户" : "协作";
      const runtime = snail?.runtime ? ` · ${snail.runtime}` : "";
      return `<div class="participant-pill"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(role + runtime)}</span></div>`;
    }).join("") : '<div class="empty-state">当前 conversation 未声明参与者</div>';
    elements.participantsSummaryCard.innerHTML = `
      <div class="context-card-header"><div class="context-card-title">Participants</div><button class="context-card-link" data-inspector-open="stage">详情</button></div>
      <div class="participant-stack">${items}</div>
    `;
  }

  function renderDeliverablesSummary() {
    const stage = state.currentStage;
    const outputArtifacts = stage?.output_artifacts || [];
    const definition = stage?.stage_definition;
    const outputDescription = definition?.output_description || "";
    const isArchived = state.currentFeature?.status === "archived";
    const artifactPills = outputArtifacts.map((a) => `<div class="deliverable-pill">${escapeHtml(a)}${isArchived ? "" : ` <button class="deliverable-remove" data-remove-artifact="${escapeHtml(a)}">×</button>`}</div>`).join("");
    elements.deliverablesSummaryCard.innerHTML = `
      <div class="context-card-header"><div class="context-card-title">Deliverables</div></div>
      <div class="context-line"><span>产出数量</span><span>${outputArtifacts.length}</span></div>
      ${outputDescription ? `<div class="meta" style="margin-top: 8px;">产出描述</div><pre style="margin-top: 4px;">${escapeHtml(outputDescription)}</pre>` : ""}
      ${outputArtifacts.length ? `<div class="meta" style="margin-top: 8px;">产出记录</div><div style="margin-top: 4px;">${artifactPills}</div>` : ""}
      ${isArchived ? "" : `<div style="margin-top: 8px; display: flex; gap: 4px;"><input type="text" class="artifact-input" placeholder="添加产出记录..." style="flex:1; padding: 4px 8px; border-radius: 4px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 12px;"><button class="artifact-add-btn" style="padding: 4px 8px; border-radius: 4px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; cursor: pointer; font-size: 12px;">添加</button></div>`}
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
    renderStageSummary();
    renderParticipantsSummary();
    renderDeliverablesSummary();
  }

  function bindInspectorEvents() {
    elements.drawerBackdrop.addEventListener("click", closeInspector);
    elements.inspectorClose.addEventListener("click", closeInspector);
    elements.inspectorTabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-inspector-tab]");
      if (!button) return;
      setInspectorTab(button.getAttribute("data-inspector-tab"));
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-inspector-open]");
      if (!button) return;
      openInspector(button.getAttribute("data-inspector-open"));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && elements.inspectorDrawer.classList.contains("visible")) closeInspector();
    });
  }

  return {
    bindInspectorEvents,
    nextStepText,
    renderContextRail,
    renderProjectSummary,
  };
}
