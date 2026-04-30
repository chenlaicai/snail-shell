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

function mediaRule(source: string, mediaQuery: string, selector: string): string {
  const mediaStart = source.indexOf(mediaQuery);
  assert(mediaStart >= 0, `${mediaQuery} must exist`);
  const mediaEnd = source.indexOf("</style>", mediaStart);
  const mediaSource = source.slice(mediaStart, mediaEnd >= 0 ? mediaEnd : undefined);
  return cssRule(mediaSource, selector);
}

const styles = fs.readFileSync(path.resolve(__dirname, "../../src/web/styles.css"), "utf8");
const shell = fs.readFileSync(path.resolve(__dirname, "../../src/web/ui-shell.js"), "utf8");
const appShellKnowledgeRule = cssRule(styles, '.app-shell[data-primary-view="knowledge"]');
const mobileAppShellKnowledgeRule = mediaRule(styles, "@media (max-width: 760px)", '.app-shell[data-primary-view="knowledge"]');
const workspaceMainRule = cssRule(styles, ".workspace-main");
const workspaceMainActiveRule = cssRule(styles, ".workspace-main.is-active");
const knowledgePanelActiveRule = cssRule(styles, ".knowledge-panel.is-active");
const eventSummaryRule = cssRule(styles, ".message-event-block summary");

assert(appShellKnowledgeRule.includes("grid-template-columns: 292px minmax(0, 1fr)"), "knowledge view must not reserve the project context rail column");
assert(mobileAppShellKnowledgeRule.includes("grid-template-columns: 1fr"), "mobile knowledge view must not reserve the hidden sidebar column");
assert(workspaceMainRule.includes("flex-direction: column"), "workspace main must stack header, messages, and composer vertically");
assert(workspaceMainRule.includes("min-height: 0"), "workspace main must allow the message pane to shrink inside the shell");
assert(workspaceMainActiveRule.includes("display: flex"), "active workspace main must use flex layout");
assert(knowledgePanelActiveRule.includes("display: block"), "active knowledge panel must own its visible layout separately from workspace main");
assert(eventSummaryRule.includes("display: grid"), "event summaries must align event kind labels at the row start");
assert(eventSummaryRule.includes("grid-template-columns: auto minmax(0, 1fr) auto"), "event summaries must reserve a stable leading column for event kind labels");
assert(eventSummaryRule.includes("align-items: center"), "event summaries must keep labels, previews and disclosure controls on one visual row");
const eventSummaryTextRule = cssRule(styles, ".message-event-summary");
assert(eventSummaryTextRule.includes("overflow: hidden"), "event summary previews must not expand the summary row horizontally");
assert(eventSummaryTextRule.includes("text-overflow: ellipsis"), "event summary previews must truncate long text instead of wrapping");
assert(eventSummaryTextRule.includes("white-space: nowrap"), "event summary previews must keep the title row to one line");
assert(shell.includes('data-view-related="projects"'), "project-only side panels must be marked as project view related");
assert(shell.includes('data-view-related="knowledge"'), "knowledge-only side panels must be marked as knowledge view related");
assert(shell.includes('data-view-pane="projects"'), "project workspace must declare its primary view ownership");
assert(shell.includes('data-view-pane="knowledge"'), "knowledge workspace must declare its primary view ownership");

console.log("workspace-layout tests passed");
