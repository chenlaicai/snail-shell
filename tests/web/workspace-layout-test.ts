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
const workspaceMainRule = cssRule(html, ".workspace-main");
const workspaceMainActiveRule = cssRule(html, ".workspace-main.active");

assert(workspaceMainRule.includes("flex-direction: column"), "workspace main must stack header, messages, and composer vertically");
assert(workspaceMainRule.includes("min-height: 0"), "workspace main must allow the message pane to shrink inside the shell");
assert(workspaceMainActiveRule.includes("display: flex"), "active workspace main must use flex layout");

console.log("workspace-layout tests passed");
