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
const renderer = fs.readFileSync(path.resolve(__dirname, "../../src/web/message-renderer.js"), "utf8");
const appShellKnowledgeRule = cssRule(styles, '.app-shell[data-primary-view="knowledge"]');
const mobileAppShellKnowledgeRule = mediaRule(styles, "@media (max-width: 760px)", '.app-shell[data-primary-view="knowledge"]');
const workspaceMainRule = cssRule(styles, ".workspace-main");
const workspaceMainActiveRule = cssRule(styles, ".workspace-main.is-active");
const knowledgePanelActiveRule = cssRule(styles, ".knowledge-panel.is-active");
const appShellRule = cssRule(styles, ".app-shell");
const mainPanelRule = cssRule(styles, ".main-panel");
const assistantEventStreamMessageRule = cssRule(styles, ".msg.assistant.message-shell.has-event-stream");
const eventSummaryRule = cssRule(styles, ".message-event-block summary");
const eventSummaryDisclosureRule = cssRule(styles, ".message-event-block summary::after");
const eventKindRule = cssRule(styles, ".message-event-kind");
const truncateOneLineRule = cssRule(styles, ".ui-truncate-one-line");

assert(appShellRule.includes("grid-template-columns: 326px minmax(0, 1fr) 318px"), "home shell must use the confirmed left, middle and right column layout");
assert(appShellKnowledgeRule.includes("grid-template-columns: 326px minmax(0, 1fr) 318px"), "knowledge view must use the same directory, content and context columns");
assert(mobileAppShellKnowledgeRule.includes("grid-template-columns: 1fr"), "mobile knowledge view must not reserve the hidden sidebar column");
assert(workspaceMainRule.includes("flex-direction: column"), "workspace main keeps a column fallback for existing active-panel semantics");
assert(workspaceMainRule.includes("min-height: 0"), "workspace main must allow the message pane to shrink inside the shell");
assert(workspaceMainActiveRule.includes("display: flex"), "active workspace main must use flex layout");
assert(mainPanelRule.includes("grid-template-rows: minmax(0, 1fr) auto"), "project content must remove the repeated top header and reserve only messages plus composer");
assert(knowledgePanelActiveRule.includes("display: block"), "active knowledge panel must own its visible layout separately from workspace main");
assert(assistantEventStreamMessageRule.includes("width: 78%"), "completed assistant stream messages must not shrink to the collapsed stream summary width");
assert(eventSummaryRule.includes("display: grid"), "event summaries must align event kind labels at the row start");
assert(eventSummaryRule.includes("grid-template-columns: max-content minmax(0, 1fr) 14px"), "event summaries must reserve stable columns for kind, title and disclosure controls");
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

console.log("workspace-layout tests passed");
