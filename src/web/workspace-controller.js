import { buildArchiveCleanupNotice } from "./archive-cleanup-notice.js";
import { editRepoContext as editIssueRepoContext } from "./repo-context-view.js";
import { isIssueArchived } from "./issue-readonly-state.js";

/**
 * Workspace 控制器：管理工作区、Issue 和 Stage 的选择、创建、归档和渲染。
 * 从 app.js 提取，保持 app.js 行数在限制内。
 */
export function createWorkspaceController({
  api, state, workspaceTree, workspaceContext, snailDenController, showNotice, switchPrimaryView,
}) {
  let stageController = null;
  let loadStageConversations = null;
  let selectConversation = null;
  let createConversation = null;
  let renderActiveMessages = null;
  let renderWorkspaceDetail = null;

  function setup(deps) {
    loadStageConversations = deps.loadStageConversations;
    selectConversation = deps.selectConversation;
    createConversation = deps.createConversation;
    renderActiveMessages = deps.renderActiveMessages;
    renderWorkspaceDetail = deps.renderWorkspaceDetail;
  }
  function setupStageController(sc) { stageController = sc; }

  function isCurrentIssueArchived() { return isIssueArchived(state.currentIssue); }
  function stageTitle(type) {
    const stage = state.currentStage;
    if (stage && stage.type === type && stage.stage_definition?.title) return stage.stage_definition.title;
    const match = state.stages.find((s) => s.type === type);
    return match?.stage_definition?.title || type;
  }

  function renderWorkspaces() {
    workspaceTree.renderTree({
      selectWorkspace, selectIssue, selectConversation, archiveIssue, createIssue, createConversation, reloadSnailConfig,
    });
  }

  async function loadWorkspaces() {
    state.workspaces = await api("GET", "/workspaces");
    renderWorkspaces();
    if (state.activePrimaryView === "workspace-config") return;
    if (!state.currentWorkspace && state.workspaces.length > 0) await selectWorkspace(state.workspaces[0].id);
  }

  async function selectWorkspace(workspaceId) {
    state.conversationSelectionToken += 1;
    state.currentWorkspace = await api("GET", `/workspaces/${workspaceId}`);
    state.issues = state.currentWorkspace.issues || [];
    state.currentIssue = state.issues.find((i) => i.current_stage?.status === "in_progress") || state.issues.find((i) => !i.closed_at) || state.issues[0] || null;
    renderWorkspaces();
    if (state.currentIssue) { await selectIssue(state.currentIssue.id); }
    else { state.stages = []; state.currentStage = null; state.conversations = []; state.currentConversation = null; renderActiveMessages(); }
    renderHeader();
  }

  async function selectIssue(issueId, options = {}) {
    state.conversationSelectionToken += 1;
    stageController.clearSuggestionState();
    state.currentIssue = await api("GET", `/issues/${issueId}`);
    state.issues = state.issues.map((i) => i.id === state.currentIssue.id ? state.currentIssue : i);
    state.stages = state.currentIssue.stages || [];
    state.currentStage = state.currentIssue.current_stage || state.stages.find((s) => s.status === "in_progress") || state.stages[state.stages.length - 1] || null;
    await stageController.loadSopTransitions();
    renderWorkspaces();
    stageController.renderStages(workspaceContext);
    if (state.currentStage) { await loadStageConversations(state.currentStage.id, { preferredConversationId: options.preferredConversationId }); }
    else { state.conversations = []; state.currentConversation = null; renderActiveMessages(); }
    renderHeader();
    checkPendingStageSuggestion(issueId);
  }

  /** 检查是否有 AI 提议的待确认阶段转移（覆盖 WebSocket 消息丢失场景）。 */
  async function checkPendingStageSuggestion(issueId) {
    try {
      const suggestion = await api("GET", `/issues/${issueId}/stage-suggestion`);
      if (suggestion) stageController.showSuggestionBanner(suggestion);
    } catch { /* ignore */ }
  }

  async function createIssue() {
    if (!state.currentWorkspace) return;
    const title = prompt("Issue 标题")?.trim();
    if (!title) return;
    const summary = prompt("Issue 摘要（可选）") || "";
    const result = await api("POST", `/workspaces/${state.currentWorkspace.id}/issues`, { title, summary });
    const refreshed = await api("GET", `/workspaces/${state.currentWorkspace.id}`);
    state.currentWorkspace = refreshed; state.issues = refreshed.issues || [];
    renderWorkspaces();
    await selectIssue(result.issue.id);
  }

  async function archiveIssue(issueId) {
    const issue = state.issues.find((i) => i.id === issueId);
    if (!issue || issue.closed_at) return;
    if (!globalThis.confirm(`归档 Issue「${issue.title}」？归档后会收纳到下方"已归档"分组。`)) return;
    const archiveResult = await api("POST", `/issues/${issueId}/archive`, {});
    const archivedIssue = archiveResult.issue || archiveResult;
    const refreshed = await api("GET", `/workspaces/${state.currentWorkspace.id}`);
    state.currentWorkspace = refreshed; state.issues = refreshed.issues || [];
    state.currentIssue = state.currentIssue?.id === issueId
      ? state.issues.find((i) => i.current_stage?.status === "in_progress") || state.issues.find((i) => !i.closed_at) || archivedIssue
      : state.issues.find((i) => i.id === state.currentIssue?.id) || state.currentIssue;
    renderWorkspaces();
    if (state.currentIssue) await selectIssue(state.currentIssue.id);
    showNotice(buildArchiveCleanupNotice(archiveResult.cleanup));
  }

  async function reloadSnailConfig() {
    if (!state.currentWorkspace) return;
    try { await api("POST", `/workspaces/${state.currentWorkspace.id}/load-snail`); await selectWorkspace(state.currentWorkspace.id); showNotice("已从 .snail 目录重新加载配置"); }
    catch (err) { showNotice(`加载失败：${err.message}`, true); }
  }

  async function refreshIssueAndRender() {
    state.currentIssue = await api("GET", `/issues/${state.currentIssue.id}`);
    state.issues = state.issues.map((i) => (i.id === state.currentIssue.id ? state.currentIssue : i));
    renderWorkspaces(); stageController.renderStages(workspaceContext); renderHeader(); workspaceContext.renderContextRail();
  }

  async function editRepoContext() {
    if (isCurrentIssueArchived()) return;
    await editIssueRepoContext({ stage: state.currentStage, showNotice });
  }

  function startWorkspaceConfig() {
    state.workspaceConfigDraft = workspaceConfigController.start();
    state.currentWorkspace = null; state.issues = []; state.currentIssue = null;
    state.stages = []; state.currentStage = null; state.conversations = []; state.currentConversation = null;
    switchPrimaryView("workspace-config"); renderWorkspaces(); renderHeader();
  }
  function cancelWorkspaceConfig() { state.workspaceConfigDraft = null; switchPrimaryView("workspaces"); renderHeader(); }

  function extractRoleBindings(draft) {
    const bindings = {};
    const dev = (draft.stage_definitions || []).find((s) => s.key === "development");
    const rev = (draft.stage_definitions || []).find((s) => s.key === "review");
    if (dev) { const p = dev.roles.find((r) => r.is_primary) || dev.roles[0]; if (p?.snail_template_id) bindings.developer = p.snail_template_id; }
    if (rev) { const r = rev.roles.find((r) => !r.is_primary) || rev.roles[rev.roles.length - 1]; if (r?.snail_template_id) bindings.reviewer = r.snail_template_id; }
    return bindings;
  }

  async function detectSnailInDirectory({ workspaceRoot, error }) {
    if (error) { showNotice(error, true); return { has_snail: false }; }
    try {
      const result = await api("POST", "/workspaces/detect-snail", { workspace_root: workspaceRoot });
      showNotice(result.has_snail ? "已检测到 .snail 目录，将从文件加载配置" : "未检测到 .snail 目录，将使用手动配置");
      return result;
    } catch (err) { showNotice(`检测失败：${err.message}`, true); return { has_snail: false }; }
  }

  async function submitWorkspaceConfig(draft, validationError) {
    if (!draft.has_snail && validationError) { showNotice(validationError, true); return; }
    if (!draft.has_snail && !snailDenController.getTemplates().length) { showNotice("Snail Den 没有可用 template，无法绑定 role 执行者", true); return; }
    try {
      const payload = { name: draft.name, summary: draft.summary, workspace_root: draft.workspace_root, role_bindings: draft.has_snail ? {} : extractRoleBindings(draft), load_from_snail: true };
      const result = await api("POST", "/workspaces", payload);
      state.workspaceConfigDraft = null; workspaceConfigController.clear();
      await loadWorkspaces(); switchPrimaryView("workspaces"); await selectWorkspace(result.workspace.id);
      showNotice(draft.has_snail ? "工作区已创建并从 .snail 目录加载配置" : "工作区已创建并初始化 .snail 目录");
    } catch (err) { showNotice(`创建工作区失败：${err.message}`, true); }
  }

  function renderHeader() {
    if (renderWorkspaceDetail) renderWorkspaceDetail();
    if (state.activePrimaryView === "workspace-config") { workspaceContext.renderWorkspaceSummary(); workspaceContext.renderContextRail(); return; }
    if (!state.currentWorkspace) { stageController.renderStageActions(); workspaceContext.renderWorkspaceSummary(); workspaceContext.renderContextRail(); return; }
    const stageLabel = state.currentStage ? stageTitle(state.currentStage.type) : "无阶段";
    const issueLabel = state.currentIssue ? state.currentIssue.title : "未选择 Issue";
    workspaceTree.renderTopState({ issueLabel, stageLabel });
    stageController.renderStageActions(); workspaceContext.renderWorkspaceSummary(); workspaceContext.renderContextRail();
  }

  let workspaceConfigController = null;
  function setWorkspaceConfigController(wcc) { workspaceConfigController = wcc; }

  return {
    setup, setupStageController, setWorkspaceConfigController, loadWorkspaces, selectWorkspace, selectIssue,
    createIssue, archiveIssue, reloadSnailConfig, refreshIssueAndRender, editRepoContext, startWorkspaceConfig,
    cancelWorkspaceConfig, submitWorkspaceConfig, detectSnailInDirectory, renderWorkspaces, stageTitle, renderHeader,
  };
}
