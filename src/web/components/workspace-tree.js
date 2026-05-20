/**
 * WorkspaceTree manages the project/feature/conversation tree in the sidebar.
 *
 * It delegates to project-tree-view.js, feature-list-view.js, and
 * workspace-context.js for actual rendering, but owns the tree container
 * and coordinates the rendering pipeline.
 */
export class WorkspaceTree {
  /**
   * @param {object} elements
   * @param {HTMLElement} elements.projectList - #project-list
   * @param {HTMLElement} elements.topProjectState - #top-project-state
   * @param {HTMLElement} elements.projectSummaryCard - #project-summary-card
   * @param {HTMLElement} elements.stageSummaryCard - #stage-summary-card
   * @param {HTMLElement} elements.bossMentionsBanner - #boss-mentions-banner
   * @param {object} deps
   * @param {object} deps.state - shared application state
   * @param {function} deps.renderProjectTree
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
   * Render the full project tree into #project-list.
   * @param {object} handlers - { selectProject, selectFeature, selectConversation, archiveFeature, createFeature, createConversation }
   */
  renderTree(handlers = {}) {
    this.deps.workspaceContext?.renderProjectSummary();
    this.deps.renderProjectTree?.(this.elements.projectList, {
      state: this.deps.state,
      stageTitle: this.deps.stageTitle,
      escapeHtml: this.deps.escapeHtml,
      renderFeatureList: this.deps.renderFeatureList,
      handlers,
    });
  }

  /**
   * Render the top project state breadcrumb.
   * @param {object} input - { featureLabel?, stageLabel? }
   */
  renderTopState(input = {}) {
    const { state } = this.deps;
    const el = this.elements.topProjectState;
    if (!el) return;

    if (state.activePrimaryView === "prompts") { el.textContent = "Prompt Center"; return; }
    if (state.activePrimaryView === "knowledge") {
      el.textContent = state.currentProject ? `知识中心 · ${state.currentProject.name}` : "知识中心";
      return;
    }
    if (state.activePrimaryView === "snail-den") { el.textContent = this.deps.snailDenController?.topStateText() || "Snail Den"; return; }
    if (state.activePrimaryView === "skills") { el.textContent = "Skill Center"; return; }
    if (state.activePrimaryView === "project-config") { el.textContent = "新建项目 · 配置页面"; return; }
    if (!state.currentProject) { el.textContent = "未选择项目"; return; }

    const featureLabel = input.featureLabel || state.currentFeature?.title || "未选择 Feature";
    const stageLabel = input.stageLabel || (state.currentStage ? this.deps.stageTitle?.(state.currentStage.type) : "无阶段");
    el.textContent = `${state.currentProject.name} · ${featureLabel} · ${stageLabel}`;
  }

  /** Render project summary and context rail. */
  renderContext() {
    this.deps.workspaceContext?.renderProjectSummary();
    this.deps.workspaceContext?.renderContextRail();
  }
}
