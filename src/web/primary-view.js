export const PRIMARY_VIEWS = new Set(["workspaces", "workspace-config", "evolution", "knowledge", "snail-den", "prompts", "skills", "mcps", "lobby"]);

export function normalizePrimaryView(view) {
  return PRIMARY_VIEWS.has(view) ? view : "workspaces";
}

export function applyPrimaryView(view, elements) {
  const activeView = normalizePrimaryView(view);
  const isWorkspaces = activeView === "workspaces";
  const isWorkspaceConfig = activeView === "workspace-config";
  const isEvolution = activeView === "evolution";
  const isKnowledge = activeView === "knowledge";
  const isSnailDen = activeView === "snail-den";
  const isPrompts = activeView === "prompts";
  const isSkills = activeView === "skills";
  const isMcps = activeView === "mcps";
  const isLobby = activeView === "lobby";

  elements.appShell.dataset.primaryView = activeView;
  setCurrentNav(elements.navWorkspaces, isWorkspaces);
  setCurrentNav(elements.navEvolution, isEvolution);
  if (elements.navKnowledge) setCurrentNav(elements.navKnowledge, isKnowledge);
  if (elements.navSnailDen) setCurrentNav(elements.navSnailDen, isSnailDen);
  if (elements.navPrompts) setCurrentNav(elements.navPrompts, isPrompts);
  if (elements.navSkills) setCurrentNav(elements.navSkills, isSkills);
  if (elements.navMcps) setCurrentNav(elements.navMcps, isMcps);
  if (elements.navLobby) setCurrentNav(elements.navLobby, isLobby);
  // In workspaces view, show task board by default; setWorkspaceSubView toggles between board/conversation
  if (isWorkspaces) {
    if (elements.taskBoardPanel) setPrimaryPanel(elements.taskBoardPanel, true);
    setPrimaryPanel(elements.workspaceMain, false);
  } else {
    if (elements.taskBoardPanel) setPrimaryPanel(elements.taskBoardPanel, false);
    setPrimaryPanel(elements.workspaceMain, false);
  }
  if (elements.workspaceConfigPanel) setPrimaryPanel(elements.workspaceConfigPanel, isWorkspaceConfig);
  setPrimaryPanel(elements.evolutionPanel, isEvolution);
  if (elements.knowledgePanel) setPrimaryPanel(elements.knowledgePanel, isKnowledge);
  if (elements.snailDenPanel) setPrimaryPanel(elements.snailDenPanel, isSnailDen);
  if (elements.promptPanel) setPrimaryPanel(elements.promptPanel, isPrompts);
  if (elements.skillPanel) setPrimaryPanel(elements.skillPanel, isSkills);
  if (elements.mcpPanel) setPrimaryPanel(elements.mcpPanel, isMcps);
  if (elements.lobbyPanel) setPrimaryPanel(elements.lobbyPanel, isLobby);
  setViewRelated(elements.viewRelated, activeView);

  return activeView;
}

function setCurrentNav(element, active) {
  element.classList.toggle("active", active);
  if (active) element.setAttribute("aria-current", "page");
  else element.removeAttribute("aria-current");
}

function setPrimaryPanel(element, active) {
  element.classList.toggle("is-active", active);
  element.hidden = !active;
}

/**
 * Toggle between task board (View A) and conversation (View B) within the
 * "workspaces" primary view.
 *
 * @param {{ taskBoardPanel: HTMLElement, workspaceMain: HTMLElement, appShell: HTMLElement, topWorkspaceState?: HTMLElement }} elements
 * @param {"board"|"conversation"} subView
 */
export function setWorkspaceSubView(elements, subView) {
  const isBoard = subView === "board";
  setPrimaryPanel(elements.taskBoardPanel, isBoard);
  setPrimaryPanel(elements.workspaceMain, !isBoard);
  // Set data attribute on app shell for CSS-based context panel visibility
  if (elements.appShell) {
    elements.appShell.dataset.workspaceView = subView;
  }
  // Hide breadcrumb in board view — the board header already shows workspace name
  if (elements.topWorkspaceState) {
    elements.topWorkspaceState.hidden = isBoard;
  }
}

function setViewRelated(elements, activeView) {
  Array.from(elements || []).forEach((element) => {
    const relatedView = element.getAttribute("data-view-related");
    element.hidden = Boolean(relatedView) && relatedView !== activeView;
  });
}
