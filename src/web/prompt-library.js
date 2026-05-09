import { escapeHtml } from "./message-view.js";

const MAX_OUTLINE_ITEMS = 8;

/**
 * Prompt Center 展示的是运行时提示词装配的阅读模型，不是新的匹配规则来源。
 * 这里按现有 prompt id / target / filePath 建立可视化分组，避免为了页面层级给
 * registry 增加前端专用字段，也避免误导使用者以为 project 级 prompt 存在静态副本。
 */
const PROMPT_ARCHITECTURE = [
  {
    id: "conversation",
    title: "Conversation System",
    caption: "系统消息骨架",
    description: "负责按 conversation 装配系统提示词的固定框架，串联 Project、Feature、Stage、Snail、历史和结尾约束。",
    pathIncludes: ["SYS-CONV-INTRO", "SYS-CONV-GLOBAL-BRIDGE", "SYS-CONV-SNAIL", "SYS-CONV-CONVERSATION", "SYS-CONV-OUTRO"],
  },
  {
    id: "global",
    title: "Global Injection",
    caption: "通用重点注入",
    description: "按角色和场景命中后追加到系统提示词中，用来承载跨 feature 的执行、检视和代码仓工作基线。",
    targets: ["conversation.system.global"],
    targetPrefixes: ["conversation.system.global"],
  },
  {
    id: "snail",
    title: "Snail Role",
    caption: "角色身份与职责",
    description: "描述各 Snail 的身份、职责边界和工作规则，决定同一 conversation 中不同参与者的行为侧重点。",
    pathIncludes: ["/scene/snails/"],
  },
  {
    id: "project",
    title: "Project Context",
    caption: "项目级上下文",
    description: "项目级提示词在运行时按当前 Project 注入；每个 Project 拥有自己的项目事实、Feature 链路和协作上下文。",
    pathIncludes: ["SYS-CONV-PROJECT"],
    showProjects: true,
  },
  {
    id: "feature",
    title: "Feature Context",
    caption: "Feature 级上下文",
    description: "承载当前 Feature 的状态、分支、worktree、PR 和正式产物边界，确保本轮工作可追溯到具体 Feature。",
    pathIncludes: ["SYS-CONV-FEATURE"],
  },
  {
    id: "stage",
    title: "Stage Context",
    caption: "阶段契约",
    description: "注入当前 Stage、上一阶段产物摘要和正式交付要求，约束研发、检视与收口动作。",
    pathIncludes: ["SYS-CONV-STAGE"],
  },
  {
    id: "history",
    title: "History Context",
    caption: "历史访问规则",
    description: "说明如何使用 conversation-history 拉取更早事实，避免在缺少上下文时凭空假设。",
    pathIncludes: ["SYS-CONV-HISTORY"],
  },
  {
    id: "knowledge",
    title: "Knowledge Context",
    caption: "知识提炼入口",
    description: "定义已审批知识的注入方式和知识候选沉淀触发点，用于长期复用偏好、规则与教训。",
    pathIncludes: ["SYS-CONV-KNOWLEDGE"],
  },
  {
    id: "skills",
    title: "Skill References",
    caption: "独立能力包引用",
    description: "列出 prompt 中声明的 skill 依赖和使用原因，正文仍由 skill 自身文件维护。",
    filter: (prompt) => Array.isArray(prompt.skill_references) && prompt.skill_references.length > 0,
  },
  {
    id: "tasks",
    title: "Task Runtime",
    caption: "后台任务提示词",
    description: "用于 conversation summary、mention extractor 等任务型运行时，target 通常唯一且不参与普通 conversation 系统消息装配。",
    targets: ["task"],
    targetPrefixes: ["task."],
  },
];

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
  if (target.startsWith("conversation.system.global")) return "Global Injection";
  if (target.startsWith("conversation.system")) return "Conversation System";
  if (target.startsWith("task.")) return "Task Runtime";
  return "Other";
}

function getPromptNode(prompt) {
  return PROMPT_ARCHITECTURE.find((node) => matchesNode(prompt, node)) || null;
}

function nodePrompts(prompts, node) {
  return prompts.filter((prompt) => matchesNode(prompt, node));
}

function matchesNode(prompt, node) {
  const target = promptTarget(prompt);
  const filePath = prompt.filePath || "";
  if (node.filter?.(prompt)) return true;
  if (node.targetPrefixes?.some((prefix) => target.startsWith(prefix))) return true;
  if (node.targets?.includes(target)) return true;
  return Boolean(node.pathIncludes?.some((part) => filePath.includes(part)));
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

function renderStats(prompts, projects) {
  const targets = new Set(prompts.map(promptTarget));
  const skillLinked = prompts.filter((prompt) => Array.isArray(prompt.skill_references) && prompt.skill_references.length).length;
  const injected = prompts.filter((prompt) => prompt.inject_matched_prompts).length;
  return `
    <div class="prompt-stats">
      <div class="prompt-stat"><strong>${prompts.length}</strong><span>Prompts</span></div>
      <div class="prompt-stat"><strong>${targets.size}</strong><span>Targets</span></div>
      <div class="prompt-stat"><strong>${projects.length}</strong><span>Projects</span></div>
      <div class="prompt-stat"><strong>${skillLinked + injected}</strong><span>Refs / injectors</span></div>
    </div>
  `;
}

function renderProjectList(projects) {
  if (!projects.length) return '<div class="empty-state">暂无 project</div>';
  return `
    <div class="prompt-project-list">
      ${projects.map((project) => `
        <div class="prompt-project-card">
          <strong>${escapeHtml(project.name || project.id)}</strong>
          <span>${escapeHtml(project.summary || "无摘要")}</span>
          <code>${escapeHtml(project.kind || "project")}</code>
        </div>
      `).join("")}
    </div>
  `;
}

function renderArchitectureHtml(prompts, selectedNodeId) {
  return `
    <div class="prompt-architecture-title">组成架构图</div>
    <div class="prompt-architecture-map">
      ${PROMPT_ARCHITECTURE.map((node, index) => {
        const promptsForNode = nodePrompts(prompts, node);
        const active = node.id === selectedNodeId ? " active" : "";
        return `
          <button class="prompt-node${active}" data-prompt-node-id="${escapeHtml(node.id)}" type="button">
            <span class="prompt-node-index">${String(index + 1).padStart(2, "0")}</span>
            <span class="prompt-node-main">
              <strong>${escapeHtml(node.title)}</strong>
              <small>${escapeHtml(node.caption)}</small>
            </span>
            <span class="prompt-node-count">${promptsForNode.length}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderNodeDetailHtml(node, prompts, projects) {
  return `
    <section class="prompt-node-detail-card">
      <div class="prompt-node-detail-header">
        <div>
          <div class="prompt-eyebrow">${escapeHtml(node.caption)}</div>
          <h3>${escapeHtml(node.title)}</h3>
        </div>
        <span>${prompts.length} prompts</span>
      </div>
      <p>${escapeHtml(node.description)}</p>
      ${node.showProjects ? renderProjectList(projects) : ""}
    </section>
  `;
}

function renderPromptDetailHtml(prompt) {
  const conditions = renderConditions(prompt);
  const skills = Array.isArray(prompt.skill_references) && prompt.skill_references.length ? prompt.skill_references : [];
  const node = getPromptNode(prompt);
  return `
    <div class="prompt-detail-card">
      <div class="prompt-detail-hero">
        <div>
          <div class="prompt-eyebrow">${escapeHtml(node?.title || promptType(prompt))}</div>
          <div class="prompt-detail-title">${escapeHtml(prompt.title)}</div>
          <div class="meta">${escapeHtml(prompt.filePath)}</div>
        </div>
        <div class="prompt-order-badge">${prompt.order !== undefined ? `#${escapeHtml(String(prompt.order))}` : "no order"}</div>
      </div>
      <div class="prompt-chip-row">
        <span class="prompt-chip">${escapeHtml(prompt.id)}</span>
        <span class="prompt-chip">${escapeHtml(promptTarget(prompt))}</span>
        ${prompt.render_mode ? `<span class="prompt-chip">${escapeHtml(prompt.render_mode)}</span>` : ""}
        ${prompt.inject_matched_prompts ? '<span class="prompt-chip accent">inject matched prompts</span>' : ""}
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

function renderPromptCardHtml(prompt, active) {
  const conditions = renderConditions(prompt);
  return `
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
      ${prompt.inject_matched_prompts ? '<span class="prompt-chip accent">injector</span>' : ""}
      ${active ? '<span class="prompt-chip accent">selected</span>' : ""}
    </div>
  `;
}

export function createPromptLibrary({ root, searchInput, targetFilter, list, detail, architecture, nodeDetail }) {
  const state = {
    prompts: [],
    projects: [],
    selectedPromptId: null,
    selectedNodeId: PROMPT_ARCHITECTURE[0].id,
  };

  const elements = root ? {
    searchInput: root.querySelector("[data-prompt-search]"),
    targetFilter: root.querySelector("[data-prompt-target-filter]"),
    list: root.querySelector("[data-prompt-list]"),
    detail: root.querySelector("[data-prompt-detail]"),
    architecture: root.querySelector("[data-prompt-architecture]"),
    nodeDetail: root.querySelector("[data-prompt-node-detail]"),
  } : { searchInput, targetFilter, list, detail, architecture, nodeDetail };

  function selectedNode() {
    return PROMPT_ARCHITECTURE.find((node) => node.id === state.selectedNodeId) || PROMPT_ARCHITECTURE[0];
  }

  function scopedPrompts() {
    return nodePrompts(state.prompts, selectedNode());
  }

  function getFilteredPrompts() {
    const query = elements.searchInput.value.trim().toLowerCase();
    const target = elements.targetFilter.value;
    return scopedPrompts()
      .filter((prompt) => !target || promptTarget(prompt) === target)
      .filter((prompt) => !query || promptSearchText(prompt).includes(query))
      .sort((left, right) => promptTarget(left).localeCompare(promptTarget(right)) || (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
  }

  function renderTargetOptions() {
    const targets = [...new Set(scopedPrompts().map(promptTarget))].sort();
    const current = elements.targetFilter.value;
    elements.targetFilter.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "当前节点全部 target";
    elements.targetFilter.appendChild(allOption);
    targets.forEach((target) => {
      const option = document.createElement("option");
      option.value = target;
      option.textContent = target;
      elements.targetFilter.appendChild(option);
    });
    if (targets.includes(current)) elements.targetFilter.value = current;
  }

  function renderArchitecture() {
    elements.architecture.innerHTML = renderArchitectureHtml(state.prompts, state.selectedNodeId);
    elements.architecture.querySelectorAll("[data-prompt-node-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedNodeId = button.getAttribute("data-prompt-node-id");
        state.selectedPromptId = null;
        renderTargetOptions();
        render();
      });
    });
  }

  function renderNodeDetail() {
    const node = selectedNode();
    elements.nodeDetail.innerHTML = renderNodeDetailHtml(node, scopedPrompts(), state.projects);
  }

  function renderDetail() {
    const prompt = state.prompts.find((item) => item.id === state.selectedPromptId);
    if (!prompt) {
      elements.detail.innerHTML = "";
      return;
    }
    elements.detail.innerHTML = renderPromptDetailHtml(prompt);
  }

  function renderList(prompts) {
    elements.list.innerHTML = "";
    if (!prompts.length) {
      elements.list.innerHTML = '<div class="empty-state">没有匹配的 prompt</div>';
      renderDetail();
      return;
    }
    if (!state.selectedPromptId || !prompts.some((prompt) => prompt.id === state.selectedPromptId)) {
      state.selectedPromptId = prompts[0].id;
    }
    elements.list.insertAdjacentHTML("beforeend", renderStats(prompts, state.projects));
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
        const active = prompt.id === state.selectedPromptId;
        card.className = "prompt-card" + (active ? " active" : "");
        card.innerHTML = renderPromptCardHtml(prompt, active);
        card.addEventListener("click", () => {
          state.selectedPromptId = prompt.id;
          render();
        });
        section.appendChild(card);
      });
      elements.list.appendChild(section);
    });
    renderDetail();
  }

  function render() {
    renderArchitecture();
    renderNodeDetail();
    renderList(getFilteredPrompts());
  }

  elements.searchInput.addEventListener("input", render);
  elements.targetFilter.addEventListener("change", render);

  return {
    setPrompts(prompts) {
      state.prompts = Array.isArray(prompts) ? prompts : [];
      renderTargetOptions();
      render();
    },
    setProjects(projects) {
      state.projects = Array.isArray(projects) ? projects : [];
      render();
    },
  };
}
