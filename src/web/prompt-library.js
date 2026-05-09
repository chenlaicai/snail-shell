import { escapeHtml } from "./message-view.js";

const MAX_OUTLINE_ITEMS = 8;

function promptTarget(prompt) {
  return prompt.target || "(no target)";
}

function promptSearchText(prompt) {
  return [
    prompt.id,
    prompt.title,
    prompt.target,
    prompt.filePath,
    prompt.content,
  ].filter(Boolean).join("\n").toLowerCase();
}

function promptType(prompt) {
  const target = promptTarget(prompt);
  if (target === "ai.base.system") return "AI Base System Prompt";
  if (target === "scenario.project-conversation.work-context") return "Project Conversation / Work Context";
  if (target === "scenario.project-conversation.stage-role-playbook") return "Project Conversation / Stage Role Playbook";
  if (target.startsWith("task.")) return "Task Runtime";
  return "Other";
}

function targetGroups(prompts) {
  return [...new Set(prompts.map(promptTarget))]
    .sort((left, right) => left.localeCompare(right))
    .map((target) => ({
      target,
      prompts: prompts
        .filter((prompt) => promptTarget(prompt) === target)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)),
    }));
}

function renderInlineValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function renderConditions(prompt) {
  return Object.entries(prompt.when || {}).map(([key, value]) => `${key}: ${renderInlineValue(value)}`);
}

function renderPromptOutline(prompt) {
  const outline = [];

  String(prompt.content || "").split("\n").forEach((line) => {
    const trimmed = line.trim();
    const heading = trimmed.match(/^(#{1,4})\s+(.+)/);
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (heading) {
      outline.push({ level: heading[1].length, text: heading[2] });
    } else if (bullet && outline.length < MAX_OUTLINE_ITEMS) {
      outline.push({ level: 5, text: bullet[1] });
    }
  });

  return outline.slice(0, MAX_OUTLINE_ITEMS);
}

function renderOutlineHtml(prompt) {
  const outline = renderPromptOutline(prompt);
  if (!outline.length) return '<div class="empty-state">未识别到标题或列表结构</div>';
  return `
    <div class="prompt-outline">
      ${outline.map((item) => `<div class="prompt-outline-item level-${Math.min(item.level, 4)}">${escapeHtml(item.text)}</div>`).join("")}
    </div>
  `;
}

function renderStats(prompts) {
  const targets = new Set(prompts.map(promptTarget));
  const skillLinked = prompts.filter((prompt) => Array.isArray(prompt.skill_references) && prompt.skill_references.length).length;
  const semanticLayers = new Set(prompts.map((prompt) => prompt.semantic_layer).filter(Boolean));
  return `
    <div class="prompt-stats">
      <div class="prompt-stat"><strong>${prompts.length}</strong><span>Prompts</span></div>
      <div class="prompt-stat"><strong>${targets.size}</strong><span>Targets</span></div>
      <div class="prompt-stat"><strong>${skillLinked}</strong><span>Skill refs</span></div>
      <div class="prompt-stat"><strong>${semanticLayers.size}</strong><span>Semantic layers</span></div>
    </div>
  `;
}

export function createPromptLibrary({ searchInput, targetFilter, list, detail }) {
  const state = {
    prompts: [],
    selectedPromptId: null,
  };

  function getFilteredPrompts() {
    const query = searchInput.value.trim().toLowerCase();
    const target = targetFilter.value;
    return state.prompts
      .filter((prompt) => !target || promptTarget(prompt) === target)
      .filter((prompt) => !query || promptSearchText(prompt).includes(query))
      .sort((left, right) => promptTarget(left).localeCompare(promptTarget(right)) || (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
  }

  function renderTargetOptions() {
    const targets = [...new Set(state.prompts.map(promptTarget))].sort();
    const current = targetFilter.value;
    targetFilter.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "全部 target";
    targetFilter.appendChild(allOption);
    targets.forEach((target) => {
      const option = document.createElement("option");
      option.value = target;
      option.textContent = target;
      targetFilter.appendChild(option);
    });
    if (targets.includes(current)) targetFilter.value = current;
  }

  function renderDetail() {
    const prompt = state.prompts.find((item) => item.id === state.selectedPromptId);
    if (!prompt) {
      detail.innerHTML = "";
      return;
    }
    const conditions = renderConditions(prompt);
    const skills = Array.isArray(prompt.skill_references) && prompt.skill_references.length ? prompt.skill_references : [];
    detail.innerHTML = `
      <div class="prompt-detail-card">
        <div class="prompt-detail-hero">
          <div>
            <div class="prompt-eyebrow">${escapeHtml(promptType(prompt))}</div>
            <div class="prompt-detail-title">${escapeHtml(prompt.title)}</div>
            <div class="meta">${escapeHtml(prompt.filePath)}</div>
          </div>
          <div class="prompt-order-badge">${prompt.order !== undefined ? `#${escapeHtml(String(prompt.order))}` : "no order"}</div>
        </div>
        <div class="prompt-chip-row">
          <span class="prompt-chip">${escapeHtml(prompt.id)}</span>
          <span class="prompt-chip">${escapeHtml(promptTarget(prompt))}</span>
          ${prompt.render_mode ? `<span class="prompt-chip">${escapeHtml(prompt.render_mode)}</span>` : ""}
          ${prompt.semantic_layer ? `<span class="prompt-chip accent">${escapeHtml(prompt.semantic_layer)}</span>` : ""}
        </div>

        <div class="prompt-detail-grid">
          <section class="prompt-info-panel">
            <div class="prompt-section-heading">匹配条件</div>
            ${conditions.length ? `<div class="prompt-kv-list">${conditions.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>` : '<div class="empty-state">总是匹配</div>'}
          </section>
          <section class="prompt-info-panel">
            <div class="prompt-section-heading">Skill References</div>
            ${skills.length ? skills.map((item) => `
              <div class="prompt-skill-card">
                <strong>${escapeHtml(item.mode)}: ${escapeHtml(item.id)}</strong>
                <span>${escapeHtml(item.reason || "")}</span>
              </div>
            `).join("") : '<div class="empty-state">无</div>'}
          </section>
        </div>

        <section class="prompt-content-panel">
          <div class="prompt-section-heading">内容结构</div>
          ${renderOutlineHtml(prompt)}
        </section>

        <section class="prompt-content-panel">
          <div class="prompt-section-heading">Prompt Content</div>
          <pre>${escapeHtml(prompt.content)}</pre>
        </section>
      </div>
    `;
  }

  function render() {
    const prompts = getFilteredPrompts();
    list.innerHTML = "";
    if (!prompts.length) {
      list.innerHTML = '<div class="empty-state">没有匹配的 prompt</div>';
      renderDetail();
      return;
    }
    if (!state.selectedPromptId || !prompts.some((prompt) => prompt.id === state.selectedPromptId)) {
      state.selectedPromptId = prompts[0].id;
    }
    list.insertAdjacentHTML("beforeend", renderStats(prompts));
    targetGroups(prompts).forEach((group) => {
      const section = document.createElement("section");
      section.className = "prompt-target-group";
      section.innerHTML = `
        <div class="prompt-target-heading">
          <div>
            <div class="prompt-target-title">${escapeHtml(group.target)}</div>
            <div class="meta">${group.prompts.length} prompts · ${escapeHtml(promptType(group.prompts[0]))}</div>
          </div>
        </div>
      `;
      group.prompts.forEach((prompt) => {
        const card = document.createElement("div");
        card.className = "prompt-card" + (prompt.id === state.selectedPromptId ? " active" : "");
        const conditions = renderConditions(prompt);
        card.innerHTML = `
          <div class="prompt-card-main">
            <div class="prompt-order-badge">${prompt.order !== undefined ? escapeHtml(String(prompt.order)) : "-"}</div>
            <div>
              <div class="name">${escapeHtml(prompt.id)}</div>
              <div class="meta">${escapeHtml(prompt.title)}</div>
            </div>
          </div>
          <div class="prompt-chip-row">
            ${prompt.render_mode ? `<span class="prompt-chip">${escapeHtml(prompt.render_mode)}</span>` : ""}
            ${conditions.length ? `<span class="prompt-chip">when ${conditions.length}</span>` : '<span class="prompt-chip">always</span>'}
            ${prompt.semantic_layer ? `<span class="prompt-chip accent">${escapeHtml(prompt.semantic_layer)}</span>` : ""}
          </div>
        `;
        card.addEventListener("click", () => {
          state.selectedPromptId = prompt.id;
          render();
        });
        section.appendChild(card);
      });
      list.appendChild(section);
    });
    renderDetail();
  }

  searchInput.addEventListener("input", render);
  targetFilter.addEventListener("change", render);

  return {
    setPrompts(prompts) {
      state.prompts = Array.isArray(prompts) ? prompts : [];
      renderTargetOptions();
      render();
    },
  };
}
