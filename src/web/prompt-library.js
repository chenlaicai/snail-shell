import { escapeHtml } from "./message-view.js";

export function createPromptLibrary({ searchInput, targetFilter, list, detail }) {
  const state = {
    prompts: [],
    selectedPromptId: null,
  };

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
    const when = prompt.when ? JSON.stringify(prompt.when, null, 2) : "总是匹配";
    const skills = Array.isArray(prompt.skill_references) && prompt.skill_references.length
      ? prompt.skill_references.map((item) => `${item.mode}: ${item.id}\n${item.reason}`).join("\n\n")
      : "无";
    detail.innerHTML = `
      <div class="artifact-card">
        <div class="name">${escapeHtml(prompt.title)}</div>
        <div class="meta" style="margin-top: 6px;">${escapeHtml(prompt.filePath)}</div>
        <div class="prompt-chip-row">
          <span class="prompt-chip">id ${escapeHtml(prompt.id)}</span>
          <span class="prompt-chip">target ${escapeHtml(promptTarget(prompt))}</span>
          ${prompt.inject_matched_prompts ? '<span class="prompt-chip">inject matched prompts</span>' : ""}
        </div>
        <div class="meta" style="margin-top: 12px;">匹配条件</div>
        <pre>${escapeHtml(when)}</pre>
        <div class="meta" style="margin-top: 12px;">Skill References</div>
        <pre>${escapeHtml(skills)}</pre>
        <div class="meta" style="margin-top: 12px;">Prompt Content</div>
        <pre>${escapeHtml(prompt.content)}</pre>
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
    prompts.forEach((prompt) => {
      const card = document.createElement("div");
      card.className = "prompt-card" + (prompt.id === state.selectedPromptId ? " active" : "");
      const conditions = Object.entries(prompt.when || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
      card.innerHTML = `
        <div class="name">${escapeHtml(prompt.id)}</div>
        <div class="meta">${escapeHtml(prompt.title)}</div>
        <div class="prompt-chip-row">
          <span class="prompt-chip">${escapeHtml(promptTarget(prompt))}</span>
          ${prompt.order !== undefined ? `<span class="prompt-chip">order ${escapeHtml(String(prompt.order))}</span>` : ""}
          ${prompt.render_mode ? `<span class="prompt-chip">${escapeHtml(prompt.render_mode)}</span>` : ""}
          ${conditions.length ? `<span class="prompt-chip">when ${conditions.length}</span>` : ""}
        </div>
      `;
      card.addEventListener("click", () => {
        state.selectedPromptId = prompt.id;
        render();
      });
      list.appendChild(card);
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
