import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * FakeElement provides the minimum surface setCurrentNav / setPrimaryPanel / setViewRelated need.
 * setAttribute / removeAttribute / getAttribute are implemented for runtime DOM behavioral assertions
 * (including accessibility contracts like aria-current="page").
 */
class FakeElement {
  readonly dataset: Record<string, string> = {};
  hidden = false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  classList = { toggle(_name: string, _force?: boolean): void {} };

  /** Internal attribute store so runtime getAttribute works for behavioral assertions. */
  private attrs = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  getAttribute(name: string): string | null {
    if (name === "data-view-related") return this.viewRelated;
    if (this.attrs.has(name)) return this.attrs.get(name)!;
    return null;
  }

  constructor(private readonly viewRelated: string | null = null) {}
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/primary-view.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ applyPrimaryView: (view: string, elements: any) => string }>;
  const { applyPrimaryView } = await dynamicImport(moduleUrl);
  const workspaceOnly = new FakeElement("workspaces");
  const evolutionOnly = new FakeElement("evolution");
  const elements = {
    appShell: new FakeElement(),
    navWorkspaces: new FakeElement(),
    navEvolution: new FakeElement(),
    taskBoardPanel: new FakeElement(),
    workspaceMain: new FakeElement(),
    evolutionPanel: new FakeElement(),
    viewRelated: [workspaceOnly, evolutionOnly],
  };

  // evolution 视图切换：面板可见、工作区和看板隐藏、viewRelated 过滤
  assert(applyPrimaryView("evolution", elements) === "evolution", "evolution should be a valid primary view");
  assert(elements.appShell.dataset.primaryView === "evolution", "app shell should expose the active primary view");
  assert(elements.evolutionPanel.hidden === false, "evolution panel should be visible");
  assert(elements.workspaceMain.hidden === true, "workspace should be hidden in evolution view");
  assert(elements.taskBoardPanel.hidden === true, "task board should be hidden in evolution view");
  assert(workspaceOnly.hidden === true && evolutionOnly.hidden === false, "workspace-only related panels should not leak into evolution view");

  // 可访问性契约：活跃导航项应标记 aria-current="page"，非活跃项不应有该属性
  assert(elements.navEvolution.getAttribute("aria-current") === "page", "active nav should set aria-current=\"page\" for screen reader accessibility");
  assert(elements.navWorkspaces.getAttribute("aria-current") === null, "inactive nav should not have aria-current attribute");

  // 未知视图回退到 workspaces
  assert(applyPrimaryView("unknown", elements) === "workspaces", "unknown primary views should fall back to workspaces");
  assert(elements.appShell.dataset.primaryView === "workspaces", "fallback view should update the app shell");
  assert(elements.taskBoardPanel.hidden === false, "task board should be visible after fallback to workspaces");
  assert(elements.workspaceMain.hidden === true, "workspace conversation should be hidden by default (task board shown instead)");
  assert(workspaceOnly.hidden === false && evolutionOnly.hidden === true, "evolution-only related panels should be hidden in workspaces view");

  // 可访问性契约：回退后 workspaces 导航应标记 aria-current
  assert(elements.navWorkspaces.getAttribute("aria-current") === "page", "fallback active nav should set aria-current=\"page\"");
  assert(elements.navEvolution.getAttribute("aria-current") === null, "fallback inactive nav should not have aria-current");

  console.log("primary-view tests passed");
}

main().catch((error) => {
  throw error;
});
