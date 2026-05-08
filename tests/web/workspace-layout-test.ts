import fs from "fs";
import path from "path";

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

const styles = fs.readFileSync(path.resolve(__dirname, "../../src/web/styles.css"), "utf8");
const shell = fs.readFileSync(path.resolve(__dirname, "../../src/web/ui-shell.js"), "utf8");
const renderer = fs.readFileSync(path.resolve(__dirname, "../../src/web/message-renderer.js"), "utf8");
const appShellKnowledgeRule = cssRule(styles, '.app-shell[data-primary-view="knowledge"]');
const workspaceMainRule = cssRule(styles, ".workspace-main");
const workspaceMainActiveRule = cssRule(styles, ".workspace-main.is-active");
const knowledgePanelActiveRule = cssRule(styles, ".knowledge-panel.is-active");
const appShellRule = cssRule(styles, ".app-shell");
const mainPanelRule = cssRule(styles, ".main-panel");
const workspaceHeaderRule = cssRule(styles, ".workspace-header");
const sidebarRule = cssRule(styles, ".sidebar");
const sidebarMainRule = cssRule(styles, ".sidebar-main");
const workspaceTreeRule = cssRule(styles, ".workspace-tree");
const buttonRule = exactCssRule(styles, "button");
const sendButtonRule = cssRule(styles, "#send-btn");
const featureRowRule = cssRule(styles, ".feature-row");
const composerHintsGridRule = cssRule(styles, ".composer .composer-hints,");
const nodeHeaderRule = cssRule(styles, ".node-header");
const nodeMainRule = cssRule(styles, ".node-main");
const knowledgePanelRule = cssRule(styles, ".knowledge-panel");
const knowledgeDetailRule = cssRule(styles, ".knowledge-detail");
const knowledgeDirectoryRowRule = cssRule(styles, ".knowledge-directory-row");
const assistantEventStreamMessageRule = cssRule(styles, ".msg.assistant.message-shell.has-event-stream");
const eventSummaryRule = cssRule(styles, ".message-event-block summary");
const eventSummaryDisclosureRule = cssRule(styles, ".message-event-block summary::after");
const eventKindRule = cssRule(styles, ".message-event-kind");
const truncateOneLineRule = cssRule(styles, ".ui-truncate-one-line");

assert(appShellRule.includes("grid-template-columns: 390px minmax(0, 1fr) 318px"), "home shell must give the left directory enough readable width");
assert(appShellKnowledgeRule.includes("grid-template-columns: 390px minmax(0, 1fr) 318px"), "knowledge view must use the same readable directory, content and context columns");
assert(!styles.includes("@media (max-width"), "desktop shell must not hide primary columns behind mobile-style breakpoints");
assert(sidebarRule.includes("grid-template-rows: auto auto minmax(0, 1fr) auto"), "sidebar must reserve a bounded middle row for the directory tree");
assert(sidebarRule.includes("overflow: hidden"), "sidebar must not become the competing scroll container for the directory tree");
assert(sidebarMainRule.includes("display: grid"), "sidebar main must constrain the active directory pane height");
assert(sidebarMainRule.includes("grid-template-rows: minmax(0, 1fr)"), "sidebar main must give workspace tree a bounded scroll area");
assert(workspaceTreeRule.includes("height: 100%"), "workspace tree must fill the bounded sidebar middle row");
assert(workspaceTreeRule.includes("overflow: auto"), "workspace tree must own scrolling so lower features remain reachable");
assert(!buttonRule.includes("width: 100%"), "generic buttons must not stretch composer actions into full-width bars");
assert(sendButtonRule.includes("width: 84px"), "send button must stay compact in the composer grid");
assert(!composerHintsGridRule.includes("grid-column: 1 / -1"), "composer hints must stay in the input column so the send button remains on the same row");
assert(featureRowRule.includes("grid-template-columns: minmax(0, 1fr)"), "feature rows must give titles the full directory row instead of sharing width with archive actions");
assert(styles.includes("justify-items: start"), "single-column feature rows must not stretch archive actions into full-width bars");
assert(nodeHeaderRule.includes("width: 100%"), "directory headers must use the widened sidebar instead of truncating inside a short flex box");
assert(nodeHeaderRule.includes("min-width: 0"), "directory headers must allow nested titles to shrink within the full row");
assert(nodeMainRule.includes("flex: 1 1 auto"), "directory title groups must receive the remaining readable row width");
assert(workspaceMainRule.includes("flex-direction: column"), "workspace main keeps a column fallback for existing active-panel semantics");
assert(workspaceMainRule.includes("min-height: 0"), "workspace main must allow the message pane to shrink inside the shell");
assert(workspaceMainActiveRule.includes("display: flex"), "active workspace main must use flex layout");
assert(mainPanelRule.includes("grid-template-rows: minmax(0, 1fr) auto"), "project content must remove the repeated top header and reserve only messages plus composer");
assert(!shell.includes('class="workspace-header"'), "middle project column must not render the removed top header");
assert(!shell.includes('id="conversation-title"'), "conversation title must not reappear as a duplicate middle-column header");
assert(!workspaceHeaderRule, "removed workspace header styles must not remain as an active layout contract");
assert(knowledgePanelRule.includes("overflow: hidden"), "knowledge panel must not make the directory list and detail share one page scrollbar");
assert(knowledgePanelActiveRule.includes("display: flex"), "active knowledge panel must size the independent detail scroller");
assert(knowledgeDetailRule.includes("overflow: auto"), "knowledge detail must own its scrollbar for detail and action content");
assert(knowledgeDirectoryRowRule.includes("width: 100%"), "knowledge directory rows must fill the left directory column");
assert(assistantEventStreamMessageRule.includes("width: 78%"), "completed assistant stream messages must not shrink to the collapsed stream summary width");
assert(eventSummaryRule.includes("display: grid"), "event summaries must align event kind labels at the row start");
assert(eventSummaryRule.includes("grid-template-columns: minmax(0, 96px) minmax(0, 1fr) 14px"), "event summaries must cap event kind width so the title keeps readable space");
assert(eventSummaryRule.includes("align-items: center"), "event summaries must keep labels, previews and disclosure controls on one visual row");
assert(eventSummaryDisclosureRule.includes("justify-self: end"), "event disclosure controls must stay pinned to the reserved final grid column");
assert(eventKindRule.includes("max-width: 96px"), "event kind labels must not steal title width in streaming or completed layouts");
assert(eventKindRule.includes("text-overflow: ellipsis"), "long event kind labels must truncate instead of pushing disclosure controls to a new line");
assert(truncateOneLineRule.includes("min-width: 0"), "stable title text must be able to shrink inside grid and flex rows");
assert(truncateOneLineRule.includes("overflow: hidden"), "stable title text must not expand its row horizontally");
assert(truncateOneLineRule.includes("text-overflow: ellipsis"), "stable title text must truncate long text instead of wrapping");
assert(truncateOneLineRule.includes("white-space: nowrap"), "stable title text must keep the title row to one line");
assert(renderer.includes('classes.push("has-event-stream")'), "completed stream messages must expose a width-stabilizing class to CSS");
assert(renderer.includes('className = "message-event-summary ui-truncate-one-line"'), "event summary previews must use the shared stable title text utility");
assert(shell.includes('data-view-related="projects"'), "project-only side panels must be marked as project view related");
assert(shell.includes('data-view-related="knowledge"'), "knowledge-only side panels must be marked as knowledge view related");
assert(shell.includes('class="brand-bar"'), "system identity must live in the left directory column");
assert(shell.includes('id="directory-toggle"'), "primary directory switcher must be collapsible");
assert(shell.includes('data-view-pane="projects"'), "project workspace must declare its primary view ownership");
assert(shell.includes('data-view-pane="knowledge"'), "knowledge workspace must declare its primary view ownership");
assert(!shell.includes('id="feature-list"'), "features must be rendered inside the selected project node instead of as a global sibling list");
assert(!shell.includes('data-knowledge-action="approve"'), "knowledge context rail must not expose approval actions without a selected knowledge record");
assert(shell.includes('id="knowledge-list"'), "knowledge entries must be rendered in the left directory column");
assert(!shell.includes('id="knowledge-library-tree-btn"'), "knowledge sidebar must not be a static fake navigation tree");

console.log("workspace-layout tests passed");
