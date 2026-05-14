import { escapeHtml } from "./message-view.js";

function renderSkillList(skills, selectedName) {
  if (!skills.length) return '<div class="empty-state">没有已注册的 Skill</div>';
  return skills.map((skill) => {
    const isActive = skill.name === selectedName;
    return `<div class="skill-list-item${isActive ? " active" : ""}" data-skill-name="${escapeHtml(skill.name)}" role="option" aria-selected="${isActive ? "true" : "false"}">
      <span class="skill-list-item-name">${escapeHtml(skill.name)}</span>
      <span class="skill-list-item-desc">${escapeHtml(skill.description || "")}</span>
    </div>`;
  }).join("");
}

function renderSkillDetail(skill) {
  if (!skill) return '<div class="skill-detail-empty">选择左侧 Skill 查看详细信息</div>';
  return `<div class="skill-detail-card">
    <div class="skill-detail-hero">
      <div>
        <div class="skill-eyebrow">Skill</div>
        <div class="skill-detail-title">${escapeHtml(skill.title)}</div>
        <div class="meta">${escapeHtml(skill.filePath || "")}</div>
      </div>
    </div>
    <div class="skill-chip-row">
      <span class="skill-chip">${escapeHtml(skill.name)}</span>
    </div>
    <section class="skill-info-panel">
      <div class="skill-section-heading">Description</div>
      <p class="skill-description-text">${escapeHtml(skill.description || "无描述")}</p>
    </section>
    <section class="skill-content-panel">
      <div class="skill-section-heading">Content</div>
      <pre class="skill-raw-content">${escapeHtml(skill.content || "")}</pre>
    </section>
  </div>`;
}

/**
 * Create a Skill Center instance.
 *
 * @param {Object} options
 * @param {HTMLElement} options.root - Container element
 * @returns {{ setSkills: (skills: any[]) => void }}
 */
export function createSkillCenter({ root }) {
  const state = {
    skills: [],
    selectedName: null,
    filterQuery: "",
  };

  function getSelectedSkill() {
    return state.skills.find((s) => s.name === state.selectedName) || null;
  }

  function filterSkills(skills, query) {
    if (!query) return skills;
    const q = query.toLowerCase();
    return skills.filter((skill) => {
      const text = [skill.name, skill.title, skill.description, skill.filePath, skill.content].filter(Boolean).join("\n").toLowerCase();
      return text.includes(q);
    });
  }

  function render() {
    const filtered = filterSkills(state.skills, state.filterQuery);

    if (!state.selectedName || !filtered.some((s) => s.name === state.selectedName)) {
      state.selectedName = filtered.length ? filtered[0].name : null;
    }

    const statsHtml = `<div class="skill-center-stats">
      <div class="skill-stat"><strong>${state.skills.length}</strong><span>Skills</span></div>
    </div>`;

    const searchHtml = `<div class="skill-center-search">
      <input type="text" class="skill-center-search-input" placeholder="搜索 name / description / 内容" value="${escapeHtml(state.filterQuery)}">
    </div>`;

    root.innerHTML = `<div class="skill-center-layout">
      <div class="skill-center-list-panel">
        <div class="skill-center-header"><div class="skill-eyebrow">Skill Center</div><div class="skill-center-title">已注册 Skill</div></div>
        ${statsHtml}
        ${searchHtml}
        <div class="skill-list">${renderSkillList(filtered, state.selectedName)}</div>
      </div>
      <div class="skill-center-detail-panel">
        ${renderSkillDetail(getSelectedSkill())}
      </div>
    </div>`;

    bindEvents();
  }

  function bindEvents() {
    root.querySelectorAll(".skill-list-item").forEach((el) => {
      el.addEventListener("click", () => {
        state.selectedName = el.getAttribute("data-skill-name");
        render();
      });
    });

    const searchInput = root.querySelector(".skill-center-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.filterQuery = searchInput.value.trim();
        render();
        const newInput = root.querySelector(".skill-center-search-input");
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(state.filterQuery.length, state.filterQuery.length);
        }
      });
    }
  }

  return {
    setSkills(skills) {
      state.skills = Array.isArray(skills) ? skills : [];
      render();
    },
  };
}
