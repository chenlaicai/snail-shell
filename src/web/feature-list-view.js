export function renderFeatureList(element, input) {
  const { state, stageTitle, escapeHtml, onSelectFeature, onArchiveFeature } = input;
  element.innerHTML = "";
  if (!state.currentProject) {
    element.innerHTML = '<div class="empty-state">先选择一个项目</div>';
    return;
  }
  if (state.features.length === 0) {
    element.innerHTML = '<div class="empty-state">暂无 Feature</div>';
    return;
  }
  const { activeFeatures, archivedFeatures } = buildFeatureGroups(state.features);
  renderFeatureGroup(element, { title: null, features: activeFeatures, state, stageTitle, escapeHtml, onSelectFeature, onArchiveFeature });
  if (archivedFeatures.length > 0) {
    renderFeatureGroup(element, { title: "已归档", features: archivedFeatures, state, stageTitle, escapeHtml, onSelectFeature, onArchiveFeature });
  }
}

export function buildFeatureGroups(features) {
  return {
    activeFeatures: features.filter((feature) => feature.status !== "archived"),
    archivedFeatures: features.filter((feature) => feature.status === "archived"),
  };
}

function renderFeatureGroup(element, input) {
  const { title, features, state, stageTitle, escapeHtml, onSelectFeature, onArchiveFeature } = input;
  if (title) {
    const heading = document.createElement("div");
    heading.className = "feature-group-title";
    heading.textContent = `${title} (${features.length})`;
    element.appendChild(heading);
  }
  features.forEach((feature) => {
    const row = document.createElement("div");
    row.className = "feature-row" + (feature.status === "archived" ? " archived" : "") + (state.currentFeature?.id === feature.id ? " active" : "");
    const badge = feature.boss_pending_count > 0 ? `<span class="pending-badge">@${feature.boss_pending_count}</span>` : "";
    const stageLabel = feature.current_stage ? `${stageTitle(feature.current_stage.type)} #${feature.current_stage.sequence}` : "无阶段";
    const archiveButton = feature.status === "archived" ? "" : '<button type="button" class="feature-archive-button">归档</button>';
    row.innerHTML = `
      <button type="button" class="feature-select-button">
        <div class="name" style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><span>${escapeHtml(feature.title)}</span>${badge}</div>
        <div class="meta">${escapeHtml(feature.status)} · ${escapeHtml(stageLabel)}</div>
      </button>
      ${archiveButton}
    `;
    row.querySelector(".feature-select-button").addEventListener("click", () => onSelectFeature(feature.id));
    row.querySelector(".feature-archive-button")?.addEventListener("click", () => onArchiveFeature(feature.id));
    element.appendChild(row);
  });
}
