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

const html = fs.readFileSync(path.resolve(__dirname, "../../src/web/index.html"), "utf8");
const appShellKnowledgeRule = cssRule(html, '.app-shell[data-primary-view="knowledge"]');
const workspaceMainRule = cssRule(html, ".workspace-main");
const workspaceMainActiveRule = cssRule(html, ".workspace-main.is-active");
const knowledgePanelActiveRule = cssRule(html, ".knowledge-panel.is-active");

assert(appShellKnowledgeRule.includes("grid-template-columns: 292px minmax(0, 1fr)"), "knowledge view must not reserve the project context rail column");
assert(workspaceMainRule.includes("flex-direction: column"), "workspace main must stack header, messages, and composer vertically");
assert(workspaceMainRule.includes("min-height: 0"), "workspace main must allow the message pane to shrink inside the shell");
assert(workspaceMainActiveRule.includes("display: flex"), "active workspace main must use flex layout");
assert(knowledgePanelActiveRule.includes("display: block"), "active knowledge panel must own its visible layout separately from workspace main");
assert(html.includes('data-view-related="projects"'), "project-only side panels must be marked as project view related");
assert(html.includes('data-view-related="knowledge"'), "knowledge-only side panels must be marked as knowledge view related");
assert(html.includes('data-view-pane="projects"'), "project workspace must declare its primary view ownership");
assert(html.includes('data-view-pane="knowledge"'), "knowledge workspace must declare its primary view ownership");

console.log("workspace-layout tests passed");
