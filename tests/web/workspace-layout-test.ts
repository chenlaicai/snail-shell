import fs from "fs";
import path from "path";
import { getShellHTML } from "./helpers/shell-dom.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function cssRule(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
}

function exactCssRule(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
}

function checkLayoutTokens(
  styles: string,
  appShellRule: string,
  appShellKnowledgeRule: string,
) {
  assert(appShellRule.includes("grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--context-panel-width)"), "home shell must give the left directory enough readable width via design tokens");
  assert(appShellKnowledgeRule.includes("grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--context-panel-width)"), "knowledge view must use the same readable directory, content and context columns via design tokens");
  assert(styles.includes("--sidebar-width: 390px"), "sidebar width token must preserve the existing readable width");
  assert(styles.includes("--context-panel-width: 318px"), "context panel width token must preserve the existing readable width");
  assert(!styles.includes("@media (max-width"), "desktop shell must not hide primary columns behind mobile-style breakpoints");
}

function checkSidebarLayout(
  sidebarRule: string,
  sidebarMainRule: string,
  workspaceTreeRule: string,
  directorySummaryRule: string,
  directoryChevronRule: string,
) {
  assert(sidebarRule.includes("grid-template-rows: auto auto minmax(0, 1fr) auto"), "sidebar must reserve a bounded middle row for the directory tree");
  assert(sidebarRule.includes("overflow: hidden"), "sidebar must not become the competing scroll container for the directory tree");
  assert(sidebarMainRule.includes("display: grid"), "sidebar main must constrain the active directory pane height");
  assert(sidebarMainRule.includes("grid-template-rows: minmax(0, 1fr)"), "sidebar main must give workspace tree a bounded scroll area");
  assert(workspaceTreeRule.includes("height: 100%"), "workspace tree must fill the bounded sidebar middle row");
  assert(workspaceTreeRule.includes("overflow: auto"), "workspace tree must own scrolling so lower features remain reachable");
  assert(directorySummaryRule.includes("width: 100%"), "primary directory summary must span the sidebar so its collapse control reaches the right edge");
  assert(directoryChevronRule.includes("margin-left: auto"), "primary directory collapse control must be pushed to the right edge");
}

function checkComposerLayout(
  styles: string,
  shell: string,
  buttonRule: string,
  sendButtonRule: string,
  composerRule: string,
  composerInputStackRule: string,
  composerActionsRule: string,
  featureRowRule: string,
  nodeHeaderRule: string,
  nodeMainRule: string,
) {
  assert(!buttonRule.includes("width: 100%"), "generic buttons must not stretch composer actions into full-width bars");
  assert(sendButtonRule.includes("width: 84px"), "send button must stay compact in the composer grid");
  assert(shell.includes('class="composer-input-stack"'), "composer input and hints must be grouped so hints cannot push send actions to a new row");
  assert(shell.includes('class="composer-actions button-row"'), "composer actions must be a dedicated grid area next to the input stack");
  assert(composerRule.includes('"input actions"'), "composer grid must place the input stack and send actions on the same row");
  assert(composerInputStackRule.includes("grid-area: input"), "composer input stack must occupy the input grid area");
  assert(composerActionsRule.includes("grid-area: actions"), "composer actions must occupy the actions grid area");
  assert(composerActionsRule.includes("flex-wrap: nowrap"), "composer actions must not wrap the send button onto a new visual row");
  assert(featureRowRule.includes("grid-template-columns: minmax(0, 1fr) auto"), "feature rows must reserve a right action column while keeping title width flexible");
  assert(nodeHeaderRule.includes("width: 100%"), "directory headers must use the widened sidebar instead of truncating inside a short flex box");
  assert(nodeHeaderRule.includes("min-width: 0"), "directory headers must allow nested titles to shrink within the full row");
  assert(nodeMainRule.includes("flex: 1 1 auto"), "directory title groups must receive the remaining readable row width");
}

function checkMainPanel(
  workspaceMainRule: string,
  workspaceMainActiveRule: string,
  mainPanelRule: string,
  shell: string,
  workspaceHeaderRule: string,
) {
  assert(workspaceMainRule.includes("flex-direction: column"), "workspace main keeps a column fallback for existing active-panel semantics");
  assert(workspaceMainRule.includes("min-height: 0"), "workspace main must allow the message pane to shrink inside the shell");
  assert(workspaceMainActiveRule.includes("display: flex"), "active workspace main must use flex layout");
  assert(mainPanelRule.includes("grid-template-rows: minmax(0, 1fr) auto"), "project content must remove the repeated top header and reserve only messages plus composer");
  assert(!shell.includes('class="workspace-header"'), "middle project column must not render the removed top header");
  assert(!shell.includes('id="conversation-title"'), "conversation title must not reappear as a duplicate middle-column header");
  assert(!workspaceHeaderRule, "removed workspace header styles must not remain as an active layout contract");
}

function checkKnowledgeLayout(
  knowledgePanelRule: string,
  knowledgePanelActiveRule: string,
  knowledgeDetailRule: string,
  knowledgeDirectoryRowRule: string,
) {
  assert(knowledgePanelRule.includes("overflow: hidden"), "knowledge panel must not make the directory list and detail share one page scrollbar");
  assert(knowledgePanelActiveRule.includes("display: flex"), "active knowledge panel must size the independent detail scroller");
  assert(knowledgeDetailRule.includes("overflow: auto"), "knowledge detail must own its scrollbar for detail and action content");
  assert(knowledgeDirectoryRowRule.includes("width: 100%"), "knowledge directory rows must fill the left directory column");
}

function checkEventMessageLayout(
  styles: string,
  renderer: string,
  eventBlockRenderer: string,
  assistantEventStreamMessageRule: string,
  eventSummaryRule: string,
  eventBlockRule: string,
  eventBodyRule: string,
  openEventBodyRule: string,
  eventDisclosureRule: string,
  eventKindRule: string,
  eventSummaryTextRule: string,
  truncateOneLineRule: string,
) {
  assert(assistantEventStreamMessageRule.includes("width: var(--message-max-width)"), "completed assistant stream messages must not shrink to the collapsed stream summary width");
  assert(styles.includes("--message-max-width: 78%"), "message max-width token must preserve the existing readable width");
  assert(eventBlockRule.includes("white-space: normal"), "event blocks must reset message-level pre-wrap so grid summaries stay on one row");
  assert(eventSummaryRule.includes("display: grid"), "event summaries must align event kind labels at the row start");
  assert(eventSummaryRule.includes("grid-template-columns: 10px minmax(0, 88px) minmax(0, 1fr) 14px"), "event summaries must keep prefix, kind, title and disclosure on one explicit row");
  assert(eventSummaryRule.includes("align-items: center"), "event summaries must keep labels, previews and disclosure controls on one visual row");
  assert(eventSummaryRule.includes("min-width: 0"), "event summaries must allow the title column to shrink without pushing disclosure controls down");
  assert(!eventBlockRenderer.includes("document.createElement(\"details\")"), "event rows must not use native details because browsers insert default summary text");
  assert(!eventBlockRenderer.includes("document.createElement(\"summary\")"), "event rows must not use native summary markers that can add an extra disclosure arrow");
  assert(renderer.includes('className = "message-event-summary-row"'), "event rows must use a custom header so only controlled disclosure arrows are rendered");
  assert(renderer.includes('classList.add("is-open")'), "event rows must persist default-open state without native details");
  assert(renderer.includes("toggleEventBlock"), "event rows must keep custom disclosure behavior when replacing native summary");
  assert(eventBodyRule.includes("display: none"), "event bodies must be hidden by default after replacing native details");
  assert(openEventBodyRule.includes("display: block"), "open event rows must reveal their body through the custom is-open state");
  assert(styles.includes(".message-event-prefix,") && styles.includes("width: 10px"), "event prefix disclosure must own the first grid column");
  assert(eventDisclosureRule.includes("justify-self: end"), "event disclosure controls must stay pinned to the reserved final grid column");
  assert(eventKindRule.includes("max-width: 88px"), "event kind labels must not steal title width in streaming or completed layouts");
  assert(eventKindRule.includes("text-overflow: ellipsis"), "long event kind labels must truncate instead of pushing disclosure controls to a new line");
  assert(eventSummaryTextRule.includes("min-width: 0"), "event summary text must shrink inside the middle grid column instead of forcing a wrap");
  assert(truncateOneLineRule.includes("min-width: 0"), "stable title text must be able to shrink inside grid and flex rows");
  assert(truncateOneLineRule.includes("overflow: hidden"), "stable title text must not expand its row horizontally");
  assert(truncateOneLineRule.includes("text-overflow: ellipsis"), "stable title text must truncate long text instead of wrapping");
  assert(truncateOneLineRule.includes("white-space: nowrap"), "stable title text must keep the title row to one line");
  assert(renderer.includes('classes.push("has-event-stream")'), "completed stream messages must expose a width-stabilizing class to CSS");
  assert(renderer.includes('className = "message-event-prefix"'), "event prefix disclosure must be a real grid child instead of relying on native details markers");
  assert(renderer.includes('className = "message-event-summary ui-truncate-one-line"'), "event summary previews must use the shared stable title text utility");
  assert(renderer.includes('className = "message-event-disclosure"'), "event disclosure must be a real grid child instead of a pseudo-element that can wrap unpredictably");
}

function checkRepoContextLayout(
  shell: string,
  repoContextView: string,
  repoContextCardInlineRule: string,
  repoContextRowRule: string,
) {
  assert(shell.includes('data-view-related="projects"'), "project-only side panels must be marked as project view related");
  assert(shell.includes('id="repo-context-summary-section"'), "repository context must be directly visible in the project context rail");
  assert(shell.indexOf('id="repo-context-summary-section"') < shell.indexOf('id="stage-summary-card"'), "repository context should be visible before lower-frequency stage details");
  assert(shell.includes('id="repo-context-summary-card"'), "repository context summary card must have its own visible render target");
  assert(shell.includes('id="repo-context-edit-btn"'), "repository context edit button must stay directly visible in the project context rail");
  assert(repoContextView.includes('<span>分支</span>'), "repository context view must render the branch field explicitly");
  assert(repoContextView.includes('<span>Worktree</span>'), "repository context view must render the worktree field explicitly");
  assert(repoContextView.includes('<span>PR</span>'), "repository context view must render the PR field explicitly");
  assert(repoContextView.includes('fields.branch_name || "未记录"'), "branch must show an explicit empty value instead of hiding the field");
  assert(repoContextView.includes('fields.worktree_path || "未记录"'), "worktree must show an explicit empty value instead of hiding the field");
  assert(repoContextView.includes('fields.pr_url || "未记录"'), "PR must show an explicit empty value instead of hiding the field");
  assert(repoContextCardInlineRule.includes("background: rgba(var(--color-bg-overlay), 0.58)"), "visible repository context card must follow context rail card styling via overlay token");
  assert(repoContextRowRule.includes("grid-template-columns: minmax(70px, auto) minmax(0, 1fr)"), "repository context labels and long values must remain readable in the context rail");
}

function checkKnowledgeShell(shell: string) {
  assert(shell.includes('data-view-related="knowledge"'), "knowledge-only side panels must be marked as knowledge view related");
  assert(shell.includes('class="brand-bar"'), "system identity must live in the left directory column");
  assert(shell.includes('id="directory-toggle"'), "primary directory switcher must be collapsible");
  assert(shell.includes('data-view-pane="projects"'), "project workspace must declare its primary view ownership");
  assert(shell.includes('data-view-pane="knowledge"'), "knowledge workspace must declare its primary view ownership");
  assert(!shell.includes('id="feature-list"'), "features must be rendered inside the selected project node instead of as a global sibling list");
  assert(!shell.includes('data-knowledge-action="approve"'), "knowledge context rail must not expose approval actions without a selected knowledge record");
  assert(shell.includes('id="knowledge-list"'), "knowledge entries must be rendered in the left directory column");
  assert(!shell.includes('id="knowledge-library-tree-btn"'), "knowledge sidebar must not be a static fake navigation tree");
  assert(shell.includes('id="knowledge-candidates-btn">待治理</button>'), "knowledge candidate mode should be framed as governance instead of approval");
  assert(shell.includes('<span>待治理</span><span id="knowledge-pending-count">-</span>'), "knowledge context rail should count pending governance items");
  assert(shell.includes('<span>流程模型</span><span>governance</span>'), "knowledge context rail should show the governance workflow model");
  assert(shell.includes("候选知识需要经过治理对话、查重定性和裁决去向判断"), "knowledge context rail should describe the new governance workflow");
  assert(!shell.includes('>待审批<'), "knowledge shell must not keep old pending approval labels");
  assert(!shell.includes('<span>approval</span>'), "knowledge shell must not expose the old approval workflow label");
}

function checkProjectConfigLayout(
  shell: string,
  workspaceContext: string,
  projectConfigPageRule: string,
  projectConfigPanelRule: string,
  projectConfigGridRule: string,
  stageActionRowRule: string,
) {
  assert(projectConfigPageRule.includes("overflow: auto"), "project configuration page must own scrolling for long stage and role forms");
  assert(projectConfigPanelRule.includes("flex-direction: column"), "project configuration panel must act as an independent primary view container");
  assert(projectConfigGridRule.includes("repeat(2, minmax(0, 1fr))"), "project configuration form must use readable two-column groups on desktop");
  assert(shell.indexOf('id="project-config-panel"') < shell.indexOf('id="workspace-main"'), "project configuration panel should live beside the project workspace instead of inside it");
  assert(!shell.includes('id="next-stage-btn"'), "stage advance must not remain as a hidden inspector-era button");
  assert(!shell.includes('id="restart-development-btn"'), "restart development must not remain as a hidden inspector-era button");
  assert(workspaceContext.includes('data-stage-action="advance"'), "project context rail must expose a visible stage advance action");
  assert(workspaceContext.includes('data-stage-action="restart"'), "project context rail must expose a visible restart development action");
  assert(stageActionRowRule.includes("grid-template-columns: 1fr 1fr"), "stage action row must keep advance and restart visible as peer actions");
  assert(!workspaceContext.includes("roleDef.snail_id"), "participants must not depend on a role definition snail_id field that the stage API does not expose");
  assert(workspaceContext.includes("participantsByName.set(name"), "participants must be keyed by role definition name so role duties and rules render");
  assert(!workspaceContext.includes('repoContextEditButton?.addEventListener("click"'), "repo context edit handler must not accumulate on the fixed shell button across context rail renders");
  assert(workspaceContext.includes("repoContextEditButton.onclick"), "repo context edit handler must replace the fixed shell button handler on render");
}

async function main() {
  const stylesDir = path.resolve(__dirname, "../../src/web/styles");
  const styles = [
    fs.readFileSync(path.join(stylesDir, "tokens.css"), "utf8"),
    fs.readFileSync(path.join(stylesDir, "base.css"), "utf8"),
    fs.readFileSync(path.join(stylesDir, "layout.css"), "utf8"),
    fs.readFileSync(path.join(stylesDir, "utilities.css"), "utf8"),
    ...fs.readdirSync(path.join(stylesDir, "components")).map((f) => fs.readFileSync(path.join(stylesDir, "components", f), "utf8")),
  ].join("\n");

  const shell = await getShellHTML();
  const repoContextView = fs.readFileSync(path.resolve(__dirname, "../../src/web/repo-context-view.js"), "utf8");
  const renderer = fs.readFileSync(path.resolve(__dirname, "../../src/web/message-renderer.js"), "utf8");
  const eventBlockRenderer = renderer.slice(renderer.indexOf("function createEventBlock"), renderer.indexOf("export function shouldOpenEventBlock"));
  const workspaceContext = fs.readFileSync(path.resolve(__dirname, "../../src/web/workspace-context.js"), "utf8");

  checkLayoutTokens(styles, cssRule(styles, ".app-shell"), cssRule(styles, '.app-shell[data-primary-view="knowledge"]'));
  checkSidebarLayout(cssRule(styles, ".sidebar"), cssRule(styles, ".sidebar-main"), cssRule(styles, ".workspace-tree"), cssRule(styles, ".directory-summary"), cssRule(styles, ".directory-chevron"));
  checkComposerLayout(styles, shell, exactCssRule(styles, "button"), cssRule(styles, "#send-btn"), cssRule(styles, ".composer"), cssRule(styles, ".composer-input-stack"), cssRule(styles, ".composer .composer-actions"), cssRule(styles, ".feature-row"), cssRule(styles, ".node-header"), cssRule(styles, ".node-main"));
  checkMainPanel(cssRule(styles, ".workspace-main"), cssRule(styles, ".workspace-main.is-active"), cssRule(styles, ".main-panel"), shell, cssRule(styles, ".workspace-header"));
  checkKnowledgeLayout(cssRule(styles, ".knowledge-panel"), cssRule(styles, ".knowledge-panel.is-active"), cssRule(styles, ".knowledge-detail"), cssRule(styles, ".knowledge-directory-row"));
  checkEventMessageLayout(styles, renderer, eventBlockRenderer, cssRule(styles, ".msg.assistant.message-shell.has-event-stream"), cssRule(styles, ".message-event-summary-row"), cssRule(styles, ".message-event-block"), cssRule(styles, ".message-event-body"), cssRule(styles, ".message-event-block.is-open > .message-event-body"), cssRule(styles, ".message-event-disclosure"), cssRule(styles, ".message-event-kind"), cssRule(styles, ".message-event-summary"), cssRule(styles, ".ui-truncate-one-line"));
  checkRepoContextLayout(shell, repoContextView, cssRule(styles, ".repo-context-card-inline"), cssRule(styles, ".repo-context-row"));
  checkKnowledgeShell(shell);
  checkProjectConfigLayout(shell, workspaceContext, cssRule(styles, ".project-config-page"), cssRule(styles, ".project-config-panel"), cssRule(styles, ".project-config-grid"), cssRule(styles, ".stage-action-row"));

  console.log("workspace-layout tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
