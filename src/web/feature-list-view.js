export function renderFeatureList(element, input) {
  const { state, stageTitle, escapeHtml, onSelectFeature, onArchiveFeature, onCreateConversation, onSelectConversation, renderConversationList } = input;
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
  renderFeatureGroup(element, { title: null, features: activeFeatures, state, stageTitle, escapeHtml, onSelectFeature, onArchiveFeature, onCreateConversation, onSelectConversation, renderConversationList });
  if (archivedFeatures.length > 0) {
    renderFeatureGroup(element, { title: "已归档", features: archivedFeatures, state, stageTitle, escapeHtml, onSelectFeature, onArchiveFeature, onCreateConversation, onSelectConversation, renderConversationList });
  }
}

export function buildFeatureGroups(features) {
  return {
    activeFeatures: features.filter((feature) => feature.status !== "archived"),
    archivedFeatures: features.filter((feature) => feature.status === "archived"),
  };
}

function renderFeatureGroup(element, input) {
  const { title, features, state, escapeHtml, onSelectFeature, onArchiveFeature, onCreateConversation, onSelectConversation, renderConversationList } = input;
  if (title) {
    const heading = document.createElement("div");
    heading.className = "feature-group-title";
    heading.textContent = `${title} (${features.length})`;
    element.appendChild(heading);
  }
  features.forEach((feature) => {
    const row = document.createElement("div");
    row.className = "feature-row" + (feature.status === "archived" ? " archived" : "") + (state.currentFeature?.id === feature.id ? " active" : "");
    const isCurrentFeature = state.currentFeature?.id === feature.id;
    const badge = feature.boss_pending_count > 0 ? `<span class="pending-badge">@${feature.boss_pending_count}</span>` : "";
    const archiveButton = feature.status === "archived" ? "" : '<button type="button" class="feature-archive-button">归档</button>';
    row.innerHTML = `
      <button type="button" class="feature-select-button">
        <span class="node-main feature-title-row"><span class="chevron">${isCurrentFeature ? "▾" : "▸"}</span><span class="node-title feature-title-text">${escapeHtml(feature.title)}</span></span>
      </button>
      <div class="feature-row-actions">${badge}${archiveButton}</div>
    `;
    row.querySelector(".feature-select-button").addEventListener("click", () => onSelectFeature(feature.id));
    row.querySelector(".feature-archive-button")?.addEventListener("click", () => onArchiveFeature(feature.id));
    if (isCurrentFeature) {
      row.appendChild(renderCurrentFeatureConversations({ state, escapeHtml, onCreateConversation, onSelectConversation, renderConversationList }));
    }
    element.appendChild(row);
  });
}

function renderCurrentFeatureConversations(input) {
  const { state, escapeHtml, onCreateConversation, onSelectConversation, renderConversationList } = input;
  const wrapper = document.createElement("div");
  wrapper.className = "feature-conversation-branch";
  const tools = document.createElement("div");
  tools.className = "tree-conversation-tools";
  tools.innerHTML = '<button class="secondary-button" type="button">新建对话</button>';
  const list = document.createElement("div");
  list.className = "conversation-list";
  wrapper.append(tools, list);
  tools.querySelector("button").addEventListener("click", onCreateConversation);
  renderConversationList(list, { state, escapeHtml, onSelectConversation });
  return wrapper;
}
