import { escapeHtml } from "./message-view.js";

/**
 * Tree label overrides for directory names in .meta/prompts/
 * Keys match the directory segment names; unmapped names fall back to the raw segment.
 */
const TREE_LABELS = {
  base: "Base Layer",
  scenarios: "Scenario Layer",
  "project-conversation": "Project Conversation",
  "work-context": "Work Context",
  "stage-role-playbook": "Stage Role Playbook",
  "task-runtime": "Task Runtime",
};

const SEMANTIC_LAYER_LABELS = {
  ai_base: "AI Base",
  work_context: "Work Context",
  stage_role_playbook: "Stage Role Playbook",
  task_runtime: "Task Runtime",
};

function treeLabel(segment) {
  return TREE_LABELS[segment] || segment;
}

function promptRelativePath(prompt) {
  /** filePath is relative to cwd, e.g. ".meta/prompts/base/B-01-xxx.md" */
  const prefix = ".meta/prompts/";
  const fp = prompt.filePath || "";
  return fp.startsWith(prefix) ? fp.slice(prefix.length) : fp;
}

function renderInlineValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function renderConditions(prompt) {
  return Object.entries(prompt.when || {}).map(([key, value]) => `${key}: ${renderInlineValue(value)}`);
}

/**
 * Build a tree structure from prompt documents.
 * Returns an array of tree nodes: { label, children?, prompt?, isLeaf }
 */
function buildPromptTree(prompts) {
  /** root-level map: segment → { label, children Map, prompt } */
  const root = new Map();

  for (const prompt of prompts) {
    const relPath = promptRelativePath(prompt);
    const segments = relPath.split("/");
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        /** Leaf node — the prompt file itself */
        const label = prompt.id + " " + prompt.title;
        current.set(seg, { label, prompt, isLeaf: true });
      } else {
        /** Directory node */
        if (!current.has(seg)) {
          current.set(seg, { label: treeLabel(seg), children: new Map(), isLeaf: false });
        }
        current = current.get(seg).children;
      }
    }
  }

  return mapToSortedArray(root);
}

function mapToSortedArray(map) {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, node]) => {
    if (node.isLeaf) return node;
    return { ...node, children: mapToSortedArray(node.children) };
  });
}

/** Recursively collect all prompt nodes from a tree */
function collectPrompts(nodes) {
  const result = [];
  for (const node of nodes) {
    if (node.isLeaf && node.prompt) {
      result.push(node.prompt);
    } else if (node.children) {
      result.push(...collectPrompts(node.children));
    }
  }
  return result;
}

function renderOutline(prompt) {
  const outline = [];
  String(prompt.content || "").split("\n").forEach((line) => {
    const trimmed = line.trim();
    const heading = trimmed.match(/^(#{1,4})\s+(.+)/);
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (heading) {
      outline.push({ level: heading[1].length, text: heading[2] });
    } else if (bullet && outline.length < 12) {
      outline.push({ level: 5, text: bullet[1] });
    }
  });
  return outline.slice(0, 12);
}

function renderOutlineHtml(prompt) {
  const outline = renderOutline(prompt);
  if (!outline.length) return '<div class="empty-state">未识别到标题或列表结构</div>';
  return `<div class="prompt-outline">${outline.map((item) => `<div class="prompt-outline-item level-${Math.min(item.level, 4)}">${escapeHtml(item.text)}</div>`).join("")}</div>`;
}

function renderTreeNodes(nodes, selectedId, depth = 0) {
  return nodes.map((node) => {
    if (node.isLeaf) {
      const isActive = node.prompt && node.prompt.id === selectedId;
      return `<div class="prompt-tree-leaf${isActive ? " active" : ""}" data-prompt-id="${escapeHtml(node.prompt.id)}" style="--depth:${depth}">
        <span class="prompt-tree-leaf-id">${escapeHtml(node.prompt.id)}</span>
        <span class="prompt-tree-leaf-title">${escapeHtml(node.prompt.title)}</span>
      </div>`;
    }
    /** Branch node */
    const childrenHtml = renderTreeNodes(node.children, selectedId, depth + 1);
    return `<div class="prompt-tree-branch" style="--depth:${depth}">
      <div class="prompt-tree-branch-label">${escapeHtml(node.label)}</div>
      <div class="prompt-tree-branch-children">${childrenHtml}</div>
    </div>`;
  }).join("");
}

function renderPromptDetail(prompt) {
  if (!prompt) return '<div class="prompt-detail-empty">选择左侧提示词查看详细信息</div>';
  const conditions = renderConditions(prompt);
  const skills = Array.isArray(prompt.skill_references) && prompt.skill_references.length ? prompt.skill_references : [];
  const semanticLabel = SEMANTIC_LAYER_LABELS[prompt.semantic_layer] || prompt.semantic_layer || "";

  return `<div class="prompt-detail-card">
    <div class="prompt-detail-hero">
      <div>
        <div class="prompt-eyebrow">${escapeHtml(semanticLabel)} · ${escapeHtml(prompt.target || "")}</div>
        <div class="prompt-detail-title">${escapeHtml(prompt.title)}</div>
        <div class="meta">${escapeHtml(promptRelativePath(prompt))}</div>
      </div>
      <div class="prompt-order-badge">${prompt.order !== undefined ? `#${escapeHtml(String(prompt.order))}` : ""}</div>
    </div>
    <div class="prompt-chip-row">
      <span class="prompt-chip">${escapeHtml(prompt.id)}</span>
      ${prompt.target ? `<span class="prompt-chip">${escapeHtml(prompt.target)}</span>` : ""}
      ${semanticLabel ? `<span class="prompt-chip accent">${escapeHtml(semanticLabel)}</span>` : ""}
    </div>

    <div class="prompt-detail-grid">
      <section class="prompt-info-panel">
        <div class="prompt-section-heading">匹配条件</div>
        ${conditions.length ? `<div class="prompt-kv-list">${conditions.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>` : '<div class="empty-state">总是匹配</div>'}
      </section>
      <section class="prompt-info-panel">
        <div class="prompt-section-heading">Skill References</div>
        ${skills.length ? skills.map((item) => `<div class="prompt-skill-card"><strong>${escapeHtml(item.mode)}: ${escapeHtml(item.id)}</strong><span>${escapeHtml(item.reason || "")}</span></div>`).join("") : '<div class="empty-state">无</div>'}
      </section>
    </div>

    <section class="prompt-content-panel">
      <div class="prompt-section-heading">内容结构</div>
      ${renderOutlineHtml(prompt)}
    </section>

    <section class="prompt-content-panel">
      <div class="prompt-section-heading">Prompt Content</div>
      <pre class="prompt-raw-content">${escapeHtml(prompt.content)}</pre>
    </section>
  </div>`;
}

/**
 * Create a Prompt Center instance.
 *
 * @param {Object} options
 * @param {HTMLElement} options.root - Container element
 * @param {boolean} [options.compact=false] - Compact mode for Inspector
 * @returns {{ setPrompts: (prompts: any[]) => void }}
 */
export function createPromptCenter({ root, compact = false }) {
  const state = {
    prompts: [],
    tree: [],
    selectedPromptId: null,
    filterQuery: "",
  };

  function getSelectedPrompt() {
    return state.prompts.find((p) => p.id === state.selectedPromptId) || null;
  }

  function filterTree(nodes, query) {
    if (!query) return nodes;
    const q = query.toLowerCase();
    const result = [];
    for (const node of nodes) {
      if (node.isLeaf) {
        const p = node.prompt;
        const searchText = [p.id, p.title, p.target, p.filePath, p.content].filter(Boolean).join("\n").toLowerCase();
        if (searchText.includes(q)) result.push(node);
      } else {
        const filteredChildren = filterTree(node.children, query);
        if (filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
    }
    return result;
  }

  function render() {
    const filteredTree = filterTree(state.tree, state.filterQuery);
    const filteredPrompts = collectPrompts(filteredTree);

    /** Auto-select first if current selection is not in filtered results */
    if (!state.selectedPromptId || !filteredPrompts.some((p) => p.id === state.selectedPromptId)) {
      state.selectedPromptId = filteredPrompts.length ? filteredPrompts[0].id : null;
    }

    const treeHtml = filteredTree.length
      ? renderTreeNodes(filteredTree, state.selectedPromptId)
      : '<div class="empty-state">没有匹配的提示词</div>';

    const statsHtml = `<div class="prompt-center-stats">
      <div class="prompt-stat"><strong>${state.prompts.length}</strong><span>Prompts</span></div>
      <div class="prompt-stat"><strong>${countLayers(state.prompts)}</strong><span>Layers</span></div>
      <div class="prompt-stat"><strong>${countTargets(state.prompts)}</strong><span>Targets</span></div>
      <div class="prompt-stat"><strong>${countSkillRefs(state.prompts)}</strong><span>Skill Refs</span></div>
    </div>`;

    const searchHtml = `<div class="prompt-center-search">
      <input type="text" class="prompt-center-search-input" placeholder="搜索 id / title / target / 内容" value="${escapeHtml(state.filterQuery)}">
    </div>`;

    root.innerHTML = `<div class="prompt-center-layout${compact ? " compact" : ""}">
      <div class="prompt-center-tree-panel">
        ${compact ? "" : '<div class="prompt-center-header"><div class="prompt-eyebrow">Prompt Center</div><div class="prompt-center-title">系统提示词组织结构</div></div>'}
        ${statsHtml}
        ${searchHtml}
        <div class="prompt-tree">${treeHtml}</div>
      </div>
      <div class="prompt-center-detail-panel">
        ${renderPromptDetail(getSelectedPrompt())}
      </div>
    </div>`;

    bindEvents();
  }

  function bindEvents() {
    /** Tree leaf clicks */
    root.querySelectorAll(".prompt-tree-leaf").forEach((el) => {
      el.addEventListener("click", () => {
        state.selectedPromptId = el.getAttribute("data-prompt-id");
        render();
      });
    });

    /** Search input */
    const searchInput = root.querySelector(".prompt-center-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.filterQuery = searchInput.value.trim();
        render();
        /** Re-focus and restore cursor position after re-render */
        const newInput = root.querySelector(".prompt-center-search-input");
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(state.filterQuery.length, state.filterQuery.length);
        }
      });
    }
  }

  function countLayers(prompts) {
    return new Set(prompts.map((p) => p.semantic_layer).filter(Boolean)).size;
  }

  function countTargets(prompts) {
    return new Set(prompts.map((p) => p.target).filter(Boolean)).size;
  }

  function countSkillRefs(prompts) {
    return prompts.filter((p) => Array.isArray(p.skill_references) && p.skill_references.length).length;
  }

  return {
    setPrompts(prompts) {
      state.prompts = Array.isArray(prompts) ? prompts : [];
      state.tree = buildPromptTree(state.prompts);
      render();
    },
  };
}

