/**
 * WorkspaceTree manages the workspace/feature/conversation tree in the sidebar.
 *
 * It delegates to workspace-tree-view.js, feature-list-view.js, and
 * workspace-context.js for actual rendering, but owns the tree container
 * and coordinates the rendering pipeline.
 */
export class WorkspaceTree {
  /**
   * @param {object} elements
   * @param {HTMLElement} elements.workspaceList - #workspace-list
   * @param {HTMLElement} elements.topWorkspaceState - #top-workspace-state
   * @param {HTMLElement} elements.workspaceSummaryCard - #workspace-summary-card
   * @param {HTMLElement} elements.stageSummaryCard - #stage-summary-card
   * @param {HTMLElement} elements.bossMentionsBanner - #boss-mentions-banner
   * @param {object} deps
   * @param {object} deps.state - shared application state
   * @param {function} deps.renderWorkspaceTreeView
   * @param {function} deps.renderFeatureList
   * @param {function} deps.stageTitle
   * @param {function} deps.escapeHtml
   * @param {object} deps.workspaceContext - workspace context controller
   * @param {object} deps.snailDenController - snail den controller (for topStateText)
   */
  constructor(elements, deps = {}) {
    this.elements = elements;
    this.deps = deps;
  }

  /**
   * Render the full workspace tree into #workspace-list.
   * @param {object} handlers - { selectWorkspace, selectFeature, selectConversation, archiveFeature, createFeature, createConversation }
   */
  renderTree(handlers = {}) {
    this.deps.workspaceContext?.renderWorkspaceSummary();
    this.deps.renderWorkspaceTreeView?.(this.elements.workspaceList, {
      state: this.deps.state,
      stageTitle: this.deps.stageTitle,
      escapeHtml: this.deps.escapeHtml,
      renderFeatureList: this.deps.renderFeatureList,
      handlers,
    });
  }

  /**
   * Render the top workspace state breadcrumb.
   * @param {object} input - { featureLabel?, stageLabel? }
   */
  renderTopState(input = {}) {
    const { state } = this.deps;
    const el = this.elements.topWorkspaceState;
    if (!el) return;

    if (state.activePrimaryView === "prompts") { el.textContent = "Prompt Center"; return; }
    if (state.activePrimaryView === "evolution") {
      el.textContent = state.currentWorkspace ? `演进中心 · ${state.currentWorkspace.name}` : "演进中心";
      return;
    }
    if (state.activePrimaryView === "snail-den") { el.textContent = this.deps.snailDenController?.topStateText() || "Snail Den"; return; }
    if (state.activePrimaryView === "skills") { el.textContent = "Skill Center"; return; }
    if (state.activePrimaryView === "workspace-config") { el.textContent = "新建工作区 · 配置页面"; return; }
    if (!state.currentWorkspace) { el.textContent = "未选择工作区"; return; }

    const featureLabel = input.featureLabel || state.currentFeature?.title || "未选择 Feature";
    const stageLabel = input.stageLabel || (state.currentStage ? this.deps.stageTitle?.(state.currentStage.type) : "无阶段");
    el.textContent = `${state.currentWorkspace.name} · ${featureLabel} · ${stageLabel}`;
  }

  /** Render workspace summary and context rail. */
  renderContext() {
    this.deps.workspaceContext?.renderWorkspaceSummary();
    this.deps.workspaceContext?.renderContextRail();
  }
}
