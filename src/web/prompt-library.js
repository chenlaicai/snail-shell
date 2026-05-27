import { escapeHtml } from "./message-view.js";

/**
 * Tree label overrides for directory names in .meta/prompts/
 * Keys match the directory segment names; unmapped names fall back to the raw segment.
 */
const TREE_LABELS = {
  prompts: "Prompts",
};

function treeLabel(segment) {
  return TREE_LABELS[segment] || segment;
}

function relativePath(item) {
  const prefix = ".meta/prompts/";
  const fp = item.filePath || "";
  return fp.startsWith(prefix) ? fp.slice(prefix.length) : fp;
}

/**
 * Build a tree structure from prompt and frame documents.
 * Returns an array of tree nodes: { label, children?, item?, isLeaf }
 */
function buildTree(prompts) {
  const root = new Map();

  for (const item of prompts) {
    const relPath = relativePath(item);
    const segments = relPath.split("/");
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        const label = item.id + " " + item.title;
        current.set(seg, { label, item, isLeaf: true });
      } else {
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

/** Maximum number of outline items to display */
const MAX_OUTLINE_ITEMS = 12;

/** Recursively collect all leaf nodes from a tree */
function collectItems(nodes) {
  const result = [];
  for (const node of nodes) {
    if (node.isLeaf && node.item) {
      result.push(node.item);
    } else if (node.children) {
      result.push(...collectItems(node.children));
    }
  }
  return result;
}

function renderOutline(content) {
  const outline = [];
  String(content || "").split("\n").forEach((line) => {
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

function renderOutlineHtml(content) {
  const outline = renderOutline(content);
  if (!outline.length) return '<div class="empty-state">未识别到标题或列表结构</div>';
  return `<div class="prompt-outline">${outline.map((item) => `<div class="prompt-outline-item level-${Math.min(item.level, 4)}">${escapeHtml(item.text)}</div>`).join("")}</div>`;
}

function renderTreeNodes(nodes, selectedId, depth = 0) {
  return nodes.map((node) => {
    if (node.isLeaf) {
      const isActive = node.item && node.item.id === selectedId;
      return `<div class="prompt-tree-leaf${isActive ? " active" : ""}" data-item-id="${escapeHtml(node.item.id)}" style="--depth:${depth}" role="option" aria-selected="${isActive ? "true" : "false"}">
        <span class="prompt-tree-leaf-id">${escapeHtml(node.item.id)}</span>
        <span class="prompt-tree-leaf-title">${escapeHtml(node.item.title)}</span>
      </div>`;
    }
    const childrenHtml = renderTreeNodes(node.children, selectedId, depth + 1);
    return `<div class="prompt-tree-branch" style="--depth:${depth}">
      <div class="prompt-tree-branch-label">${escapeHtml(node.label)}</div>
      <div class="prompt-tree-branch-children">${childrenHtml}</div>
    </div>`;
  }).join("");
}

function renderPromptDetail(prompt) {
  if (!prompt) return "";
  const skills = Array.isArray(prompt.skill_references) && prompt.skill_references.length ? prompt.skill_references : [];

  return `<div class="prompt-detail-card">
    <div class="prompt-detail-hero">
      <div>
        <div class="prompt-eyebrow">${escapeHtml(prompt.id)}</div>
        <div class="prompt-detail-title">${escapeHtml(prompt.title)}</div>
        <div class="meta">${escapeHtml(relativePath(prompt))}</div>
      </div>
    </div>
    <div class="prompt-chip-row">
      <span class="prompt-chip">${escapeHtml(prompt.id)}</span>
    </div>

    <div class="prompt-detail-grid">
      <section class="prompt-info-panel">
        <div class="prompt-section-heading">Skill References</div>
        ${skills.length ? skills.map((item) => `<div class="prompt-skill-card"><strong>${escapeHtml(item.mode)}: ${escapeHtml(item.id)}</strong><span>${escapeHtml(item.reason || "")}</span></div>`).join("") : '<div class="empty-state">无</div>'}
      </section>
    </div>

    <section class="prompt-content-panel">
      <div class="prompt-section-heading">内容结构</div>
      ${renderOutlineHtml(prompt.content)}
    </section>

    <section class="prompt-content-panel">
      <div class="prompt-section-heading">Prompt Content</div>
      <pre class="prompt-raw-content">${escapeHtml(prompt.content)}</pre>
    </section>
  </div>`;
}

function renderDetail(item) {
  if (!item) return '<div class="prompt-detail-empty">选择左侧项目查看详细信息</div>';
  return renderPromptDetail(item);
}

/**
 * Create a Prompt Center instance.
 *
 * @param {Object} options
 * @param {HTMLElement} options.root - Container element
 * @returns {{ setPrompts: (prompts: any[]) => void, setFrames: (frames: any[]) => void }}
 */
export function createPromptCenter({ root }) {
  const state = {
    prompts: [],
    tree: [],
    selectedId: null,
    filterQuery: "",
  };

  function getSelectedItem() {
    return state.prompts.find((p) => p.id === state.selectedId) || null;
  }

  function filterTree(nodes, query) {
    if (!query) return nodes;
    const q = query.toLowerCase();
    const result = [];
    for (const node of nodes) {
      if (node.isLeaf) {
        const p = node.item;
        const searchText = [p.id, p.title, p.filePath, p.content].filter(Boolean).join("\n").toLowerCase();
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
    const filteredItems = collectItems(filteredTree);

    if (!state.selectedId || !filteredItems.some((p) => p.id === state.selectedId)) {
      state.selectedId = filteredItems.length ? filteredItems[0].id : null;
    }

    const treeHtml = filteredTree.length
      ? renderTreeNodes(filteredTree, state.selectedId)
      : '<div class="empty-state">没有匹配的项目</div>';

    const statsHtml = `<div class="prompt-center-stats">
      <div class="prompt-stat"><strong>${state.prompts.length}</strong><span>Prompts</span></div>
      <div class="prompt-stat"><strong>${countSkillRefs(state.prompts)}</strong><span>Skill Refs</span></div>
    </div>`;

    const searchHtml = `<div class="prompt-center-search">
      <input type="text" class="prompt-center-search-input" placeholder="搜索 id / title / 内容" value="${escapeHtml(state.filterQuery)}">
    </div>`;

    root.innerHTML = `<div class="prompt-center-layout">
      <div class="prompt-center-tree-panel">
        <div class="prompt-center-header"><div class="prompt-eyebrow">Prompt Center</div><div class="prompt-center-title">系统提示词组织结构</div></div>
        ${statsHtml}
        ${searchHtml}
        <div class="prompt-tree">${treeHtml}</div>
      </div>
      <div class="prompt-center-detail-panel">
        ${renderDetail(getSelectedItem())}
      </div>
    </div>`;

    bindEvents();
  }

  function bindEvents() {
    root.querySelectorAll(".prompt-tree-leaf").forEach((el) => {
      el.addEventListener("click", () => {
        state.selectedId = el.getAttribute("data-item-id");
        render();
      });
    });

    const searchInput = root.querySelector(".prompt-center-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.filterQuery = searchInput.value.trim();
        render();
        const newInput = root.querySelector(".prompt-center-search-input");
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(state.filterQuery.length, state.filterQuery.length);
        }
      });
    }
  }

  function countSkillRefs(prompts) {
    return prompts.filter((p) => Array.isArray(p.skill_references) && p.skill_references.length).length;
  }

  function rebuildTree() {
    state.tree = buildTree(state.prompts);
    render();
  }

  return {
    setPrompts(prompts) {
      state.prompts = Array.isArray(prompts) ? prompts : [];
      rebuildTree();
    },
  };
}
