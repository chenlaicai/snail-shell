export function renderFeatureList(element, input) {
  const { state, stageTitle, escapeHtml, onSelectFeature } = input;
  element.innerHTML = "";
  if (!state.currentProject) {
    element.innerHTML = '<div class="empty-state">先选择一个项目</div>';
    return;
  }
  if (state.features.length === 0) {
    element.innerHTML = '<div class="empty-state">暂无 Feature</div>';
    return;
  }
  state.features.forEach((feature) => {
    const row = document.createElement("div");
    row.className = "feature-row" + (state.currentFeature?.id === feature.id ? " active" : "");
    const badge = feature.boss_pending_count > 0 ? `<span class="pending-badge">@${feature.boss_pending_count}</span>` : "";
    const stageLabel = feature.current_stage ? `${stageTitle(feature.current_stage.type)} #${feature.current_stage.sequence}` : "无阶段";
    row.innerHTML = `
      <button>
        <div class="name" style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><span>${escapeHtml(feature.title)}</span>${badge}</div>
        <div class="meta">${escapeHtml(feature.status)} · ${escapeHtml(stageLabel)}</div>
      </button>
    `;
    row.querySelector("button").addEventListener("click", () => onSelectFeature(feature.id));
    element.appendChild(row);
  });
}
