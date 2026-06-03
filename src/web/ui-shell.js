/**
 * ui-shell.js — Builds the Snail Shell application chrome using DOM API.
 *
 * Exports:
 *   el(tag, attrs, ...children) — element factory
 *   tx(text)                   — text node factory
 *   mountUiShell(root)         — append the full app shell to `root`
 */

/**
 * Create a text node.
 * @param {string} text
 * @returns {Text}
 */
export function tx(text) {
  return document.createTextNode(text);
}

/**
 * Create a DOM element.
 *
 * @param {string} tag - HTML tag name
 * @param {object} [attrs] - attribute map. Special keys:
 *   className → element.className
 *   style    → element.style.cssText
 *   hidden   → element.hidden (boolean)
 *   disabled → element.disabled (boolean)
 *   aria-*   → element.setAttribute(key, value)
 *   data-*   → element.setAttribute(key, value)
 *   type     → element.setAttribute('type', value) (for <button>/<input>)
 *   rows, placeholder → element.setAttribute(key, value)
 *   Everything else → element.setAttribute(key, value)
 * @param {...(string|Node|Array)} children - strings become text nodes, nodes are
 *   appended directly, arrays are flattened.
 * @returns {HTMLElement}
 */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue;
      if (key === "className") {
        node.className = value;
      } else if (key === "style") {
        node.style.cssText = value;
      } else if (key === "hidden") {
        node.hidden = Boolean(value);
      } else if (key === "disabled") {
        node.disabled = Boolean(value);
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  _appendChildren(node, children);
  return node;
}

function _appendChildren(parent, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      _appendChildren(parent, child);
    } else if (typeof child === "string") {
      parent.appendChild(tx(child));
    } else {
      parent.appendChild(child);
    }
  }
}

// ── Convenience helpers ──

function div(attrs, ...children) { return el("div", attrs, ...children); }
function span(attrs, ...children) { return el("span", attrs, ...children); }
function btn(attrs, ...children) { return el("button", attrs, ...children); }
function section(attrs, ...children) { return el("section", attrs, ...children); }
function aside(attrs, ...children) { return el("aside", attrs, ...children); }
function p(attrs, ...children) { return el("p", attrs, ...children); }

function _buildContextPanels() {
  return [
    aside({ className: "context-panel view-related", "data-view-related": "workspaces" }, [
      div({ className: "context-rail" }, [
        section({ className: "context-card", id: "repo-context-summary-section" }, [
          div({ className: "repo-context-summary-header" }, [
            div({ className: "context-card-title" }, "Issue Context"),
          ]),
          div({ className: "repo-context-card repo-context-card-inline", id: "repo-context-summary-card" }),
        ]),
        section({ className: "context-card workspace-progress-card", id: "stage-summary-card" }),
      ]),
    ]),
    aside({ className: "context-panel view-related", "data-view-related": "prompts", hidden: true }, [
      div({ className: "context-rail" }, [
        section({ className: "context-card" }, [
          div({ className: "context-card-header" }, [div({ className: "context-card-title" }, "Prompt Center")]),
          p({ className: "meta" }, "查看系统提示词的完整组织结构。左侧按 Base / Scenario 层级树形展示，右侧显示选中 prompt 的详情。"),
        ]),
        section({ className: "context-card" }, [
          div({ className: "context-card-header" }, [div({ className: "context-card-title" }, "Structure")]),
          div({ className: "context-line" }, [span({}, "Base 层"), span({}, "始终注入")]),
          div({ className: "context-line" }, [span({}, "Scenario 层"), span({}, "条件注入")]),
        ]),
      ]),
    ]),
    aside({ className: "context-panel view-related", "data-view-related": "skills", hidden: true }, [
      div({ className: "context-rail" }, [
        section({ className: "context-card" }, [
          div({ className: "context-card-header" }, [div({ className: "context-card-title" }, "Skill Center")]),
          p({ className: "meta" }, "查看系统中已注册的所有 Skill。Skill 是独立的能力包，供系统提示词引用。"),
        ]),
        section({ className: "context-card" }, [
          div({ className: "context-card-header" }, [div({ className: "context-card-title" }, "Structure")]),
          div({ className: "context-line" }, [span({}, "Skill 目录"), span({}, ".meta/skills/")]),
          div({ className: "context-line" }, [span({}, "入口文件"), span({}, "SKILL.md")]),
        ]),
      ]),
    ]),
    aside({ className: "context-panel view-related", "data-view-related": "evolution", hidden: true }, [
      div({ className: "context-rail" }, [
        section({ className: "context-card" }, [
          div({ className: "context-card-header" }, [div({ className: "context-card-title" }, "Evolution")]),
          div({ className: "context-line" }, [span({}, "待治理"), span({ id: "evolution-pending-count" }, "-")]),
          div({ className: "context-line" }, [span({}, "当前范围"), span({}, "Snail Shell")]),
          div({ className: "context-line" }, [span({}, "流程模型"), span({}, "governance")]),
        ]),
        section({ className: "context-card" }, [
          div({ className: "context-card-header" }, [div({ className: "context-card-title" }, "Governance Flow")]),
          p({ className: "meta" }, "治理操作只在选中演进工作区后出现。演进工作区需要经过治理对话、查重定性和裁决去向判断，不能在上下文栏伪装成未绑定对象的快捷审批。"),
        ]),
      ]),
    ]),
    aside({ className: "context-panel view-related", "data-view-related": "knowledge", hidden: true }, [
      div({ className: "context-rail" }, [
        section({ className: "context-card" }, [
          div({ className: "context-card-header" }, [div({ className: "context-card-title" }, "Knowledge Library")]),
          p({ className: "meta" }, "查看和管理已发布的知识条目。知识库是演进治理的下游产物，存放经治理审批的已发布知识。"),
        ]),
        section({ className: "context-card" }, [
          div({ className: "context-card-header" }, [div({ className: "context-card-title" }, "Scope")]),
          div({ className: "context-line" }, [span({}, "Global"), span({}, "所有项目可见")]),
          div({ className: "context-line" }, [span({}, "Workspace"), span({}, "项目级知识")]),
        ]),
      ]),
    ]),
  ];
}

/**
 * Append the complete application shell to `root`.
 * @param {HTMLElement} root
 */
export function mountUiShell(root) {
  // App notice bar
  const appNotice = div({
    id: "app-notice",
    style: "display:none; padding:10px 20px; background:#1d4ed8; color:white; font-size:13px;",
  });
  const appShell = div({ className: "app-shell" }, [
    // ── LEFT SIDEBAR ──
    aside({ className: "sidebar" }, [
      // Brand bar
      el("header", { className: "brand-bar" }, [
        div({ className: "brand-mark" }, "S"),
        div({ className: "brand-title" }, [span({}, "Snail"), " Shell"]),
      ]),

      // Sidebar toggle: visible only at narrow widths to reveal
      // the workspace tree as a floating overlay panel
      btn({ className: "sidebar-toggle", type: "button", "aria-label": "Toggle navigation" }, "☰"),

      // Backdrop overlay behind expanded sidebar panel, closes it on click
      div({ className: "sidebar-backdrop" }),

      // Directory switcher
      section({ className: "directory-switcher", id: "directory-switcher" }, [
        btn({ className: "directory-summary", id: "directory-toggle", type: "button" }, [
          span({}, [
            span({ className: "directory-title" }, "一级目录"),
            span({ className: "directory-hint" }, "低频入口，可收纳"),
          ]),
          span({ className: "directory-chevron", id: "directory-chevron" }, "▴"),
        ]),
        div({ className: "primary-nav", id: "primary-nav" }, [
          btn({ className: "primary-nav-button active", id: "nav-workspaces", "aria-current": "page" }, "工作区管理"),
          btn({ className: "primary-nav-button", id: "nav-evolution" }, "Evolution Center"),
          btn({ className: "primary-nav-button", id: "nav-knowledge" }, "知识库"),
          btn({ className: "primary-nav-button", id: "nav-snail-den" }, "Snail Den"),
          btn({ className: "primary-nav-button", id: "nav-prompts" }, "Prompt Center"),
          btn({ className: "primary-nav-button", id: "nav-skills" }, "Skill Center"),
          btn({ className: "primary-nav-button", id: "nav-mcps" }, "MCPs"),
          btn({ className: "primary-nav-button", id: "nav-lobby" }, "IM 大厅"),
        ]),
      ]),

      // Sidebar main content
      div({ className: "sidebar-main" }, [
        // Workspace tree
        div({ className: "view-related workspace-tree", "data-view-related": "workspaces" }, [
          div({ id: "workspace-summary-card", hidden: true }),
          div({ className: "tree-toolbar" }, [
            div({ className: "panel-title" }, "Workspace Tree"),
            div({ className: "button-row" }, [
              btn({ className: "primary-button", id: "new-workspace-btn" }, "新建"),
            ]),
          ]),
          section({ className: "tree-card" }, [
            div({ className: "tree-workspace-list", id: "workspace-list" }),
          ]),
        ]),

        // Evolution workspace tree
        div({ className: "view-related workspace-tree", "data-view-related": "evolution", hidden: true }, [
          div({ className: "tree-toolbar" }, [
            div({}, [
              div({ className: "panel-title" }, "Evolution Directory"),
              div({ className: "meta" }, "切换范围后查看演进工作区、治理进度和已沉淀知识"),
            ]),
            div({ className: "evolution-mode-actions" }, [
              btn({ className: "ghost-button", id: "evolution-library-btn" }, "知识库"),
              btn({ className: "ghost-button", id: "evolution-candidates-btn" }, "待治理"),
              btn({ className: "ghost-button", id: "evolution-workspace-btn" }, "当前工作区"),
              btn({ className: "primary-button", id: "new-evolution-item-btn" }, "新增"),
            ]),
          ]),
          div({ id: "evolution-summary" }),
          section({ className: "evolution-directory-list", id: "evolution-list" }),
        ]),
      ]),
    ]),

    // ── MAIN PANEL ──
    el("main", { className: "main-panel" }, [
      // Workspace config view
      div({ className: "workspace-config-panel view-pane", id: "workspace-config-panel", "data-view-pane": "workspace-config", hidden: true }, [
        div({ className: "workspace-config-page", id: "workspace-config-page" }),
      ]),

      // Workspace (workspaces) view
      div({ className: "workspace-main view-pane is-active", id: "workspace-main", "data-view-pane": "workspaces" }, [
        div({ className: "boss-mentions-banner", id: "boss-mentions-banner" }),
        div({ id: "messages" }),
        div({ className: "composer" }, [
          div({ className: "reply-banner", id: "reply-banner" }, [
            div({ id: "reply-banner-text" }),
            btn({ className: "reply-cancel", id: "reply-cancel", type: "button" }, "取消"),
          ]),
          div({ className: "composer-input-stack" }, [
            el("textarea", {
              id: "input",
              placeholder: "输入 @开发者 与指定 role 对话；未指定时默认发送给当前主 role",
              rows: "2",
            }),
            div({ className: "composer-hints" }, [
              div({ className: "mention-status", id: "mention-status" }),
              div({ className: "mention-suggestions", id: "mention-suggestions" }),
            ]),
          ]),
          div({ className: "composer-actions button-row" }, [
            btn({ className: "primary-button", id: "send-btn" }, "发送"),
            btn({ className: "danger-button", id: "interrupt-btn", type: "button", hidden: true }, "中断 Snail"),
          ]),
        ]),
      ]),

      // Evolution view
      div({ className: "evolution-panel view-pane", id: "evolution-panel", "data-view-pane": "evolution", hidden: true }, [
        div({ className: "evolution-conversation-layout", id: "evolution-detail" }),
      ]),

      // Snail Den view
      div({ className: "snail-den-panel view-pane", id: "snail-den-panel", "data-view-pane": "snail-den", hidden: true }, [
        div({ className: "snail-den-content", id: "snail-den-content" }),
      ]),

      // Prompt Center view
      div({ className: "prompt-panel view-pane", id: "prompt-panel", "data-view-pane": "prompts", hidden: true }, [
        div({ className: "prompt-center-page", id: "prompt-center-page" }),
      ]),

      // Skill Center view
      div({ className: "skill-panel view-pane", id: "skill-panel", "data-view-pane": "skills", hidden: true }, [
        div({ className: "skill-center-page", id: "skill-center-page" }),
      ]),
      div({ className: "mcp-panel view-pane", id: "mcp-panel", "data-view-pane": "mcps", hidden: true }, [div({ className: "mcp-center-page", id: "mcp-center-page" })]),
      // Knowledge Library view
      div({ className: "knowledge-panel view-pane", id: "knowledge-panel", "data-view-pane": "knowledge", hidden: true }, [div({ className: "knowledge-library-page", id: "knowledge-library-page" })]),
      // IM Lobby view
      div({ className: "lobby-panel view-pane", id: "lobby-panel", "data-view-pane": "lobby", hidden: true }, [div({ className: "lobby-page", id: "lobby-page" })]),
    ]),

    // ── RIGHT CONTEXT PANELS ──
    ..._buildContextPanels(),
  ]);

  root.appendChild(appNotice);
  root.appendChild(appShell);
}
