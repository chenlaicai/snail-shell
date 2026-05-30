export const PRIMARY_VIEWS = new Set(["projects", "project-config", "evolution", "snail-den", "prompts", "skills", "lobby"]);

export function normalizePrimaryView(view) {
  return PRIMARY_VIEWS.has(view) ? view : "projects";
}

export function applyPrimaryView(view, elements) {
  const activeView = normalizePrimaryView(view);
  const isProjects = activeView === "projects";
  const isProjectConfig = activeView === "project-config";
  const isEvolution = activeView === "evolution";
  const isSnailDen = activeView === "snail-den";
  const isPrompts = activeView === "prompts";
  const isSkills = activeView === "skills";
  const isLobby = activeView === "lobby";

  elements.appShell.dataset.primaryView = activeView;
  setCurrentNav(elements.navProjects, isProjects);
  setCurrentNav(elements.navEvolution, isEvolution);
  if (elements.navSnailDen) setCurrentNav(elements.navSnailDen, isSnailDen);
  if (elements.navPrompts) setCurrentNav(elements.navPrompts, isPrompts);
  if (elements.navSkills) setCurrentNav(elements.navSkills, isSkills);
  if (elements.navLobby) setCurrentNav(elements.navLobby, isLobby);
  setPrimaryPanel(elements.workspaceMain, isProjects);
  if (elements.projectConfigPanel) setPrimaryPanel(elements.projectConfigPanel, isProjectConfig);
  setPrimaryPanel(elements.evolutionPanel, isEvolution);
  if (elements.snailDenPanel) setPrimaryPanel(elements.snailDenPanel, isSnailDen);
  if (elements.promptPanel) setPrimaryPanel(elements.promptPanel, isPrompts);
  if (elements.skillPanel) setPrimaryPanel(elements.skillPanel, isSkills);
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

function setViewRelated(elements, activeView) {
  Array.from(elements || []).forEach((element) => {
    const relatedView = element.getAttribute("data-view-related");
    element.hidden = Boolean(relatedView) && relatedView !== activeView;
  });
}
