export const PRIMARY_VIEWS = new Set(["projects", "knowledge", "snail-den"]);

export function normalizePrimaryView(view) {
  return PRIMARY_VIEWS.has(view) ? view : "projects";
}

export function applyPrimaryView(view, elements) {
  const activeView = normalizePrimaryView(view);
  const isProjects = activeView === "projects";
  const isKnowledge = activeView === "knowledge";
  const isSnailDen = activeView === "snail-den";

  elements.appShell.dataset.primaryView = activeView;
  setCurrentNav(elements.navProjects, isProjects);
  setCurrentNav(elements.navKnowledge, isKnowledge);
  if (elements.navSnailDen) setCurrentNav(elements.navSnailDen, isSnailDen);
  setPrimaryPanel(elements.workspaceMain, isProjects);
  setPrimaryPanel(elements.knowledgePanel, isKnowledge);
  if (elements.snailDenPanel) setPrimaryPanel(elements.snailDenPanel, isSnailDen);
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
