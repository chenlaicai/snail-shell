import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// FakeElement provides the minimum surface setCurrentNav / setPrimaryPanel / setViewRelated need.
// classList/setAttribute/removeAttribute are DOM-side effects we don't assert on, but
// the call paths require them.
class FakeElement {
  readonly dataset: Record<string, string> = {};
  hidden = false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  classList = { toggle(_name: string, _force?: boolean): void {} };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setAttribute(_name: string, _value: string): void {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  removeAttribute(_name: string): void {}

  constructor(private readonly viewRelated: string | null = null) {}

  getAttribute(name: string): string | null {
    if (name === "data-view-related") return this.viewRelated;
    return null;
  }
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/primary-view.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ applyPrimaryView: (view: string, elements: any) => string }>;
  const { applyPrimaryView } = await dynamicImport(moduleUrl);
  const projectOnly = new FakeElement("projects");
  const knowledgeOnly = new FakeElement("knowledge");
  const elements = {
    appShell: new FakeElement(),
    navProjects: new FakeElement(),
    navKnowledge: new FakeElement(),
    workspaceMain: new FakeElement(),
    knowledgePanel: new FakeElement(),
    viewRelated: [projectOnly, knowledgeOnly],
  };

  // knowledge 视图切换：面板可见、工作区隐藏、viewRelated 过滤
  assert(applyPrimaryView("knowledge", elements) === "knowledge", "knowledge should be a valid primary view");
  assert(elements.appShell.dataset.primaryView === "knowledge", "app shell should expose the active primary view");
  assert(elements.knowledgePanel.hidden === false, "knowledge panel should be visible");
  assert(elements.workspaceMain.hidden === true, "project workspace should be hidden in knowledge view");
  assert(projectOnly.hidden === true && knowledgeOnly.hidden === false, "project-only related panels should not leak into knowledge view");

  // 未知视图回退到 projects
  assert(applyPrimaryView("unknown", elements) === "projects", "unknown primary views should fall back to projects");
  assert(elements.appShell.dataset.primaryView === "projects", "fallback view should update the app shell");
  assert(elements.workspaceMain.hidden === false, "project workspace should be visible after fallback");
  assert(projectOnly.hidden === false && knowledgeOnly.hidden === true, "knowledge-only related panels should be hidden in projects view");

  console.log("primary-view tests passed");
}

main().catch((error) => {
  throw error;
});
